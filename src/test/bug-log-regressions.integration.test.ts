import Decimal from "decimal.js";
import { beforeAll, describe, expect, it } from "vitest";

import {
  createManualJournalDraft,
  postManualJournal,
  reverseManualJournal,
} from "@/server/accounting/transactional-accounting-posting";
import { prisma } from "@/server/db/prisma";
import { PrismaInventoryRepository } from "@/server/inventory/prisma-inventory-repository";
import { PrismaGoodsReceiptRepository } from "@/server/purchasing/prisma-goods-receipt-repository";
import { PrismaPurchaseInvoiceRepository } from "@/server/purchasing/prisma-purchase-invoice-repository";
import { PrismaPurchaseReturnRepository } from "@/server/purchasing/prisma-purchase-return-repository";
import { PrismaPurchasingRepository } from "@/server/purchasing/prisma-purchasing-repository";
import { executePhase27GoldenWorkflow, type Phase27WorkflowState } from "./phase27-golden-workflow";

let state: Phase27WorkflowState;

beforeAll(async () => {
  state = await executePhase27GoldenWorkflow();
});

async function postedBalance(accountId: string, journalIds: readonly string[]) {
  const totals = await prisma.accountingJournalLine.aggregate({
    where: { accountId, journalId: { in: [...journalIds] }, journal: { status: "POSTED" } },
    _sum: { debit: true, credit: true },
  });
  return new Decimal(totals._sum.debit?.toString() ?? "0").sub(
    totals._sum.credit?.toString() ?? "0",
  );
}

describe("bug-log regressions", () => {
  it("BUG-27: a reversed manual journal nets to zero in every POSTED balance", async () => {
    const accounts = await prisma.accountingAccount.findMany({
      where: { active: true, postingAllowed: true, isControl: false },
      orderBy: { code: "asc" },
      take: 2,
    });
    expect(accounts).toHaveLength(2);
    const [debitAccount, creditAccount] = accounts as [
      (typeof accounts)[number],
      (typeof accounts)[number],
    ];
    const date = new Date("2026-09-27T00:00:00.000Z");
    const { originalId, reversalId } = await prisma.$transaction(async (tx) => {
      const id = await createManualJournalDraft(tx, {
        accountingDate: date,
        description: "BUG-27 regression",
        actorUserId: state.actorUserId,
        lines: [
          { accountId: debitAccount.id, debit: "500000" },
          { accountId: creditAccount.id, credit: "500000" },
        ],
      });
      await postManualJournal(tx, id, state.actorUserId);
      const reversal = await reverseManualJournal(
        tx,
        id,
        date,
        "Posted in error",
        state.actorUserId,
      );
      return { originalId: id, reversalId: reversal };
    });

    const original = await prisma.accountingJournal.findUniqueOrThrow({
      where: { id: originalId },
      include: { reversalJournal: true },
    });
    // The original stays POSTED (so balances include it) and is linked to its reversal.
    expect(original.status).toBe("POSTED");
    expect(original.reversalJournal?.id).toBe(reversalId);
    const ids = [originalId, reversalId];
    expect((await postedBalance(debitAccount.id, ids)).toFixed(2)).toBe("0.00");
    expect((await postedBalance(creditAccount.id, ids)).toFixed(2)).toBe("0.00");
    await expect(
      prisma.$transaction((tx) =>
        reverseManualJournal(tx, originalId, date, "twice", state.actorUserId),
      ),
    ).rejects.toThrow("Only an unreversed posted manual journal can be reversed.");
  });

  it("BUG-5: a stock adjustment posts its journal and stays lot-linked", async () => {
    const repository = new PrismaInventoryRepository();
    const lotBalances = await prisma.inventoryMovement.groupBy({
      by: ["inventoryLotId"],
      where: {
        itemId: state.packagingItemId,
        warehouseId: state.sourceWarehouseId,
        status: "AVAILABLE",
        inventoryLotId: { not: null },
      },
      _sum: { quantity: true },
    });
    const stocked = lotBalances.find((row) =>
      new Decimal(row._sum.quantity?.toString() ?? 0).gt(0),
    );
    expect(stocked).toBeDefined();
    const pieces = await prisma.unit.findFirstOrThrow({ where: { code: "PCS" } });

    const movementId = await repository.postSingle({
      itemId: state.packagingItemId,
      warehouseId: state.sourceWarehouseId,
      status: "AVAILABLE",
      movementType: "ADJUSTMENT_OUT",
      referenceType: "MANUAL_ADJUSTMENT",
      quantity: "1",
      unitId: pieces.id,
      reason: "Cycle count shortage",
      actorUserId: state.actorUserId,
    });

    const movement = await prisma.inventoryMovement.findUniqueOrThrow({
      where: { id: movementId },
    });
    // No lot was chosen, so the quantity was drawn from a lot (FEFO), not left untagged.
    expect(movement.inventoryLotId).not.toBeNull();
    const valuation = await prisma.inventoryValuationEntry.findUniqueOrThrow({
      where: { sourceKey: `MANUAL-COST:${movementId}` },
    });
    const journal = await prisma.accountingJournal.findUnique({
      where: {
        sourceType_sourceId: { sourceType: "VALUATION_ADJUSTMENT", sourceId: valuation.id },
      },
    });
    expect(journal?.status).toBe("POSTED");
    expect(new Decimal(journal!.totalDebit.toString()).toFixed(6)).toBe(
      new Decimal(valuation.valueDelta!.toString()).abs().toFixed(6),
    );
  });

  it("D5: a replacement for QC-rejected goods is payable and invoice-matchable", async () => {
    const purchasing = new PrismaPurchasingRepository();
    const receiving = new PrismaGoodsReceiptRepository();
    const returns = new PrismaPurchaseReturnRepository();
    const grams = await prisma.unit.findUniqueOrThrow({ where: { code: "G" } });
    const purchaseOrderId = await purchasing.createPurchaseOrder({
      supplierId: state.supplierId,
      orderDate: "2026-09-20",
      expectedDeliveryDate: "2026-09-21",
      supplierReference: "D5-REPLACEMENT",
      notes: "Replacement regression.",
      actorUserId: state.actorUserId,
      lines: [
        {
          itemId: state.rawItemId,
          quantity: "1000",
          unitId: grams.id,
          unitRate: "2",
          discountPercent: "0",
          taxPercent: "0",
        },
      ],
    });
    await purchasing.approvePurchaseOrder(purchaseOrderId, state.actorUserId);
    const order = await purchasing.getPurchaseOrder(purchaseOrderId);
    const orderLine = order!.lines[0]!;
    const receiptId = await receiving.createGoodsReceipt({
      purchaseOrderId,
      receiptDate: "2026-09-21",
      warehouseId: state.sourceWarehouseId,
      supplierDeliveryNumber: "D5-DELIVERY",
      actorUserId: state.actorUserId,
      lines: [
        {
          purchaseOrderLineId: orderLine.id,
          quantity: "1000",
          unitId: grams.id,
          supplierLotNumber: "D5-LOT",
          manufacturingDate: "2026-09-01",
          expiryDate: "2027-09-01",
        },
      ],
    });
    await receiving.postGoodsReceipt(receiptId, state.actorUserId);
    const receipt = await receiving.getGoodsReceipt(receiptId);
    const receiptLine = receipt!.lines[0]!;
    await receiving.completeGoodsReceiptQc(
      receiptId,
      [
        {
          goodsReceiptLineId: receiptLine.id,
          acceptedQuantity: "600",
          rejectedQuantity: "400",
          rejectionReason: "QUALITY_FAILURE",
          rejectionNotes: "D5 rejected quantity.",
        },
      ],
      state.actorUserId,
    );
    const source = (await returns.listEligibleReturnSources()).find(
      (candidate) =>
        candidate.goodsReceiptLineId === receiptLine.id && candidate.source === "QC_REJECTED",
    );
    expect(source).toBeDefined();
    const returnId = await returns.createPurchaseReturn({
      returnDate: "2026-09-22",
      actorUserId: state.actorUserId,
      lines: [
        {
          sourceKey: source!.key,
          quantity: "400",
          unitId: grams.id,
          reason: "QC_REJECTED",
          replacementExpected: true,
        },
      ],
    });
    await returns.postPurchaseReturn(returnId, state.actorUserId);
    const purchaseReturn = await prisma.purchaseReturn.findUniqueOrThrow({
      where: { id: returnId },
      include: { lines: true },
    });
    expect(purchaseReturn.status).toBe("AWAITING_REPLACEMENT");

    const replacementId = await receiving.createGoodsReceipt({
      purchaseOrderId,
      receiptDate: "2026-09-24",
      warehouseId: state.sourceWarehouseId,
      supplierDeliveryNumber: "D5-REPLACEMENT",
      purpose: "SUPPLIER_REPLACEMENT",
      purchaseReturnId: returnId,
      actorUserId: state.actorUserId,
      lines: [
        {
          purchaseOrderLineId: orderLine.id,
          quantity: "400",
          unitId: grams.id,
          supplierLotNumber: "D5-LOT-R",
          manufacturingDate: "2026-09-10",
          expiryDate: "2027-09-10",
          purchaseReturnLineId: purchaseReturn.lines[0]!.id,
        },
      ],
    });
    await receiving.postGoodsReceipt(replacementId, state.actorUserId);
    const replacement = await receiving.getGoodsReceipt(replacementId);
    await receiving.completeGoodsReceiptQc(
      replacementId,
      [
        {
          goodsReceiptLineId: replacement!.lines[0]!.id,
          acceptedQuantity: "400",
          rejectedQuantity: "0",
        },
      ],
      state.actorUserId,
    );

    expect(
      (await prisma.purchaseReturn.findUniqueOrThrow({ where: { id: returnId } })).status,
    ).toBe("COMPLETED");
    // The replacement inventory is accrued in GRNI, not credited to an undebited supplier claim.
    const valuation = await prisma.inventoryValuationEntry.findFirstOrThrow({
      where: { sourceId: replacementId, entryType: "SUPPLIER_REPLACEMENT" },
    });
    const receiptJournal = await prisma.accountingJournal.findUniqueOrThrow({
      where: {
        sourceType_sourceId: {
          sourceType: "GOODS_RECEIPT",
          sourceId: `replacement:${valuation.id}`,
        },
      },
      include: { lines: { include: { account: true } } },
    });
    const claims = await prisma.accountingAccountMapping.findFirstOrThrow({
      where: { mappingKey: "SUPPLIER_CLAIMS" },
    });
    expect(receiptJournal.lines.some((line) => line.accountId === claims.accountId)).toBe(false);
    // QC acceptance of the replacement recognises the payable at the PO price (400 g x 2).
    const payable = await prisma.supplierPayableLedgerEntry.findUniqueOrThrow({
      where: { sourceKey: `PURCHASE_ACCEPTANCE:${replacementId}` },
    });
    expect(new Decimal(payable.signedAmount.toString()).toFixed(2)).toBe("800.00");
    // And the supplier invoice can match it.
    const eligible = await new PrismaPurchaseInvoiceRepository().listEligibleGoodsReceiptLines();
    expect(eligible.some((line) => line.goodsReceiptId === replacementId)).toBe(true);
  });
});
