import Decimal from "decimal.js";
import { beforeAll, describe, expect, it } from "vitest";

import { reconciliation } from "@/server/accounting/prisma-accounting-repository";
import {
  backfillAccounting,
  postAutomaticJournal,
} from "@/server/accounting/transactional-accounting-posting";
import { prisma } from "@/server/db/prisma";
import { PrismaProductionBatchRepository } from "@/server/production/prisma-production-batch-repository";
import { PrismaProductionMaterialRepository } from "@/server/production/prisma-production-material-repository";
import { PrismaProductionOutputRepository } from "@/server/production/prisma-production-output-repository";
import { PrismaCustomerPaymentRepository } from "@/server/sales/prisma-customer-payment-repository";
import { executePhase27GoldenWorkflow, type Phase27WorkflowState } from "./phase27-golden-workflow";

let state: Phase27WorkflowState;

beforeAll(async () => {
  state = await executePhase27GoldenWorkflow();
});

async function runBackfill() {
  await prisma.$transaction((tx) => backfillAccounting(tx, state.actorUserId), {
    isolationLevel: "Serializable",
    timeout: 120_000,
  });
}

const differences = async () =>
  new Map((await reconciliation()).map((row) => [row.name, row.difference.toFixed(2)]));

describe("round-8 bug-log regressions", () => {
  it("BUG-38: a backfill over documents already posted live creates no journal", async () => {
    const before = await prisma.accountingJournal.findMany({ select: { id: true } });
    const differencesBefore = await differences();
    await runBackfill();
    const created = await prisma.accountingJournal.findMany({
      where: { id: { notIn: before.map((journal) => journal.id) } },
      select: { journalNumber: true, sourceType: true, sourceId: true, description: true },
    });
    expect(created).toEqual([]);
    expect(await differences()).toEqual(differencesBefore);
  });

  it("BUG-38: the accounting backfill never re-posts a bounced cheque as money received", async () => {
    const payments = new PrismaCustomerPaymentRepository();
    const chequeId = await payments.createCustomerPayment({
      customerId: state.customerId,
      paymentDate: "2026-10-01",
      method: "CHEQUE",
      totalAmount: "10546.50",
      bankName: "Meezan Bank",
      chequeNumber: `CHQ-BUG38-${Date.now()}`,
      chequeDate: "2026-10-01",
      referenceNumber: "BUG-38",
      allocations: [],
      actorUserId: state.actorUserId,
    });
    await payments.postCustomerPayment(chequeId, state.actorUserId);
    await payments.reverseCustomerPayment(
      chequeId,
      state.actorUserId,
      new Date("2026-10-02T00:00:00.000Z"),
      "Cheque bounced: insufficient funds.",
    );
    const reversal = await prisma.customerPayment.findUniqueOrThrow({
      where: { reversalOfId: chequeId },
    });
    const before = await differences();

    await runBackfill();
    // The reversal's only journal is its CUSTOMER_PAYMENT_REVERSAL; nothing books it as a receipt.
    expect(
      await prisma.accountingJournal.findMany({
        where: { sourceId: reversal.id },
        select: { sourceType: true },
      }),
    ).toEqual([{ sourceType: "CUSTOMER_PAYMENT_REVERSAL" }]);
    expect(await differences()).toEqual(before);

    // A second run is a no-op everywhere.
    const journals = await prisma.accountingJournal.count();
    await runBackfill();
    expect(await prisma.accountingJournal.count()).toBe(journals);
    expect(await differences()).toEqual(before);

    // Repair: a database where the old backfill already booked the reversal as a receipt
    // (JV-2026-000109 on the test system) is put right by the next backfill, once.
    await prisma.$transaction((tx) =>
      postAutomaticJournal(tx, {
        sourceType: "CUSTOMER_PAYMENT",
        sourceId: reversal.id,
        sourceNumber: reversal.number,
        accountingDate: reversal.paymentDate,
        description: `Customer payment: ${reversal.number}.`,
        actorUserId: state.actorUserId,
        allowHistoricalBackfill: true,
        lines: [
          { mapping: "DEFAULT_BANK", debit: "10546.50", customerId: state.customerId },
          { mapping: "ACCOUNTS_RECEIVABLE", credit: "10546.50", customerId: state.customerId },
        ],
      }),
    );
    expect((await differences()).get("Accounts Receivable")).not.toBe(
      before.get("Accounts Receivable"),
    );
    await runBackfill();
    expect(await differences()).toEqual(before);
    const corrections = await prisma.accountingJournal.count({
      where: { sourceId: `duplicate-correction:${reversal.id}` },
    });
    await runBackfill();
    expect(corrections).toBe(1);
    expect(
      await prisma.accountingJournal.count({
        where: { sourceId: `duplicate-correction:${reversal.id}` },
      }),
    ).toBe(1);
  });

  it("BUG-38: after a backfill every reversal document is booked once, as a reversal", async () => {
    await runBackfill();
    const [customerReversals, supplierReversals] = await Promise.all([
      prisma.customerPayment.findMany({
        where: { reversalOfId: { not: null } },
        select: { id: true },
      }),
      prisma.supplierPayment.findMany({
        where: { reversalOfId: { not: null } },
        select: { id: true },
      }),
    ]);
    expect(customerReversals.length).toBeGreaterThan(0);
    const ids = [...customerReversals, ...supplierReversals].map((row) => row.id);
    const journals = await prisma.accountingJournal.findMany({
      where: {
        OR: [
          { sourceId: { in: ids } },
          { sourceId: { in: ids.map((id) => `duplicate-correction:${id}`) } },
        ],
      },
      select: { sourceId: true, sourceType: true },
    });
    const of = (id: string) => journals.filter((journal) => journal.sourceId === id);
    for (const { id } of customerReversals) {
      expect(
        of(id).filter((journal) => journal.sourceType === "CUSTOMER_PAYMENT_REVERSAL"),
      ).toHaveLength(1);
      // A receipt booked by a pre-fix backfill is always taken back out by its correction.
      const bookedAsReceipt = of(id).some((journal) => journal.sourceType === "CUSTOMER_PAYMENT");
      expect(of(`duplicate-correction:${id}`)).toHaveLength(bookedAsReceipt ? 1 : 0);
    }
    // Supplier reversals post live as one SUPPLIER_PAYMENT journal and are not backfilled.
    for (const { id } of supplierReversals) expect(of(id)).toHaveLength(1);
    // The receivable control account agrees with the customer ledger after a full backfill.
    const receivable = (await reconciliation()).find((row) => row.name === "Accounts Receivable");
    expect(receivable!.comparable).toBe(true);
    expect(new Decimal(receivable!.difference.toFixed(2)).abs().toFixed(2)).toBe("0.00");
  });

  it("BUG-39: normal-batch output needs an expiry date, also on drafts saved before the rule", async () => {
    const batches = new PrismaProductionBatchRepository();
    const materials = new PrismaProductionMaterialRepository();
    const outputs = new PrismaProductionOutputRepository();
    const grams = await prisma.unit.findFirstOrThrow({ where: { code: "G" } });
    const batchId = await batches.createBatch({
      recipeId: state.recipeId,
      plannedBatchQuantity: "1000",
      plannedBatchUnitId: grams.id,
      plannedProductionDate: "2026-10-10",
      targetCompletionDate: "2026-10-11",
      rawMaterialWarehouseId: state.sourceWarehouseId,
      packagingWarehouseId: state.sourceWarehouseId,
      finishedGoodsDestinationWarehouseId: state.sourceWarehouseId,
      plannedCartons: "0",
      plannedLoosePieces: "2",
      notes: "BUG-39 expiry regression batch.",
      actorUserId: state.actorUserId,
    });
    await batches.planBatch(batchId, state.actorUserId);
    await batches.releaseBatch(batchId, state.actorUserId, true);
    const requirement = (await batches.getBatch(batchId))!.materialRequirements[0]!;
    const lots = await prisma.inventoryMovement.groupBy({
      by: ["inventoryLotId"],
      where: {
        itemId: state.rawItemId,
        warehouseId: state.sourceWarehouseId,
        status: "AVAILABLE",
        inventoryLotId: { not: null },
      },
      _sum: { quantity: true },
    });
    const lot = lots.find((row) => new Decimal(row._sum.quantity?.toString() ?? 0).gte(3));
    const issueId = await materials.createTransaction({
      productionBatchId: batchId,
      transactionType: "ISSUE",
      transactionDate: "2026-10-10T08:00",
      batchRequirementId: requirement.id,
      inventoryLotId: lot!.inventoryLotId!,
      quantity: "3",
      unitId: grams.id,
      actorUserId: state.actorUserId,
    });
    await materials.postTransaction(issueId, state.actorUserId);
    const good = {
      productionBatchId: batchId,
      outputType: "GOOD" as const,
      transactionDate: "2026-10-10T10:00",
      cartons: "0",
      loosePieces: "2",
      productionDate: "2026-10-10",
      destinationWarehouseId: state.sourceWarehouseId,
      actorUserId: state.actorUserId,
    };
    await expect(outputs.createTransaction(good)).rejects.toThrow(
      "Expiry date is required for finished goods.",
    );
    const draftId = await outputs.createTransaction({ ...good, expiryDate: "2027-04-08" });
    // A draft saved before the rule had no expiry: posting it is refused, so no lot is created.
    await prisma.productionOutputTransaction.update({
      where: { id: draftId },
      data: { expiryDate: null },
    });
    await expect(outputs.postTransaction(draftId, state.actorUserId)).rejects.toThrow(
      "Expiry date is required for finished goods.",
    );
    expect(
      await prisma.productionLot.findUnique({ where: { productionBatchId: batchId } }),
    ).toBeNull();
    // Put the issued raw material back so other suites see unchanged stock.
    await outputs.cancelTransaction(draftId, state.actorUserId, "BUG-39 regression cleanup.");
    await materials.reverseTransaction(issueId, state.actorUserId, "BUG-39 regression cleanup.");
  });
});
