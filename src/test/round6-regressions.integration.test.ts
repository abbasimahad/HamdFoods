import Decimal from "decimal.js";
import { beforeAll, describe, expect, it } from "vitest";

import { balanceSheet, reportAsOf } from "@/server/accounting/financial-reporting";
import { generalLedger, reconciliation } from "@/server/accounting/prisma-accounting-repository";
import { correctPurchaseReturnGrniClearance } from "@/server/accounting/transactional-accounting-posting";
import { prisma } from "@/server/db/prisma";
import { PrismaGoodsReceiptRepository } from "@/server/purchasing/prisma-goods-receipt-repository";
import { PrismaPurchaseReturnRepository } from "@/server/purchasing/prisma-purchase-return-repository";
import { PrismaPurchasingRepository } from "@/server/purchasing/prisma-purchasing-repository";
import { executePhase27GoldenWorkflow, type Phase27WorkflowState } from "./phase27-golden-workflow";

let state: Phase27WorkflowState;

beforeAll(async () => {
  state = await executePhase27GoldenWorkflow();
});

async function mappedAccountId(mappingKey: "GRNI" | "PURCHASE_RETURN_VARIANCE") {
  return (await prisma.accountingAccountMapping.findFirstOrThrow({ where: { mappingKey } }))
    .accountId;
}

describe("round-6 bug-log regressions", () => {
  it("BUG-35: returning QC-rejected stock clears GRNI at receipt cost, variance to 5020", async () => {
    const purchasing = new PrismaPurchasingRepository();
    const receiving = new PrismaGoodsReceiptRepository();
    const returns = new PrismaPurchaseReturnRepository();
    const grams = await prisma.unit.findUniqueOrThrow({ where: { code: "G" } });
    const grniBefore = (await reconciliation()).find((row) =>
      row.name.startsWith("Goods Received"),
    );
    expect(grniBefore).toBeDefined();

    // Received at a price that differs from the item's moving average, so carrying cost and
    // receipt cost of the rejected stock differ.
    const purchaseOrderId = await purchasing.createPurchaseOrder({
      supplierId: state.supplierId,
      orderDate: "2026-10-01",
      expectedDeliveryDate: "2026-10-02",
      supplierReference: "BUG35",
      notes: "BUG-35 regression.",
      actorUserId: state.actorUserId,
      lines: [
        {
          itemId: state.rawItemId,
          quantity: "1000",
          unitId: grams.id,
          unitRate: "7.37",
          discountPercent: "0",
          taxPercent: "0",
        },
      ],
    });
    await purchasing.approvePurchaseOrder(purchaseOrderId, state.actorUserId);
    const orderLine = (await purchasing.getPurchaseOrder(purchaseOrderId))!.lines[0]!;
    const receiptId = await receiving.createGoodsReceipt({
      purchaseOrderId,
      receiptDate: "2026-10-02",
      warehouseId: state.sourceWarehouseId,
      supplierDeliveryNumber: "BUG35-DELIVERY",
      actorUserId: state.actorUserId,
      lines: [
        {
          purchaseOrderLineId: orderLine.id,
          quantity: "1000",
          unitId: grams.id,
          supplierLotNumber: "BUG35-LOT",
          manufacturingDate: "2026-09-25",
          expiryDate: "2027-09-25",
        },
      ],
    });
    await receiving.postGoodsReceipt(receiptId, state.actorUserId);
    const receiptLine = (await receiving.getGoodsReceipt(receiptId))!.lines[0]!;
    await receiving.completeGoodsReceiptQc(
      receiptId,
      [
        {
          goodsReceiptLineId: receiptLine.id,
          acceptedQuantity: "600",
          rejectedQuantity: "400",
          rejectionReason: "QUALITY_FAILURE",
          rejectionNotes: "BUG-35 rejected quantity.",
        },
      ],
      state.actorUserId,
    );
    const source = (await returns.listEligibleReturnSources()).find(
      (candidate) =>
        candidate.goodsReceiptLineId === receiptLine.id && candidate.source === "QC_REJECTED",
    );
    const returnId = await returns.createPurchaseReturn({
      returnDate: "2026-10-03",
      actorUserId: state.actorUserId,
      lines: [
        {
          sourceKey: source!.key,
          quantity: "400",
          unitId: grams.id,
          reason: "QC_REJECTED",
          replacementExpected: false,
        },
      ],
    });
    await returns.postPurchaseReturn(returnId, state.actorUserId);

    const [grni, variance] = await Promise.all([
      mappedAccountId("GRNI"),
      mappedAccountId("PURCHASE_RETURN_VARIANCE"),
    ]);
    const journal = await prisma.accountingJournal.findUniqueOrThrow({
      where: { sourceType_sourceId: { sourceType: "PURCHASE_RETURN", sourceId: returnId } },
      include: { lines: true },
    });
    const carrying = await prisma.inventoryValuationEntry.findFirstOrThrow({
      where: { sourceType: "PURCHASE_RETURN", sourceId: returnId, entryType: "PURCHASE_RETURN" },
    });
    const carryingValue = new Decimal(carrying.valueDelta!.toString()).abs();
    const grniDebit = journal.lines
      .filter((line) => line.accountId === grni)
      .reduce((total, line) => total.add(line.debit.toString()), new Decimal(0));
    // 400 g of the 7,370.00 receipt: exactly its 2,948.00 share, whatever the average was.
    expect(grniDebit.toFixed(2)).toBe("2948.00");
    const varianceNet = journal.lines
      .filter((line) => line.accountId === variance)
      .reduce(
        (total, line) => total.add(line.credit.toString()).sub(line.debit.toString()),
        new Decimal(0),
      );
    expect(varianceNet.toFixed(2)).toBe(grniDebit.sub(carryingValue).toFixed(2));

    // Every GRNI posting of this receipt nets to zero once the rejected stock is back.
    const receiptValuation = await prisma.inventoryValuationEntry.findFirstOrThrow({
      where: { sourceKey: `GRN-COST:${receiptLine.id}` },
    });
    const grniLines = await prisma.accountingJournalLine.findMany({
      where: {
        accountId: grni,
        journal: {
          status: "POSTED",
          OR: [
            { sourceType: "GOODS_RECEIPT", sourceId: receiptValuation.id },
            { sourceType: "GOODS_RECEIPT_ACCEPTANCE", sourceId: receiptId },
            { sourceType: "PURCHASE_RETURN", sourceId: returnId },
          ],
        },
      },
    });
    expect(grniLines).toHaveLength(3);
    expect(
      grniLines
        .reduce(
          (total, line) => total.add(line.debit.toString()).sub(line.credit.toString()),
          new Decimal(0),
        )
        .toFixed(2),
    ).toBe("0.00");

    // The repair pass finds nothing to correct on a return posted with the fix.
    await prisma.$transaction((tx) =>
      correctPurchaseReturnGrniClearance(tx, returnId, state.actorUserId),
    );
    expect(
      await prisma.accountingJournal.findUnique({
        where: {
          sourceType_sourceId: {
            sourceType: "PURCHASE_RETURN",
            sourceId: `grni-correction:${returnId}`,
          },
        },
      }),
    ).toBeNull();

    // GRNI is reconciled, and this flow changed neither side of it.
    const grniAfter = (await reconciliation()).find((row) => row.name.startsWith("Goods Received"));
    expect(grniAfter!.comparable).toBe(true);
    expect(grniAfter!.difference.toFixed(2)).toBe(grniBefore!.difference.toFixed(2));
  });

  it("UX-14: the General Ledger lists one day's lines journal by journal", async () => {
    const grni = await mappedAccountId("GRNI");
    const ledger = await generalLedger(grni);
    const keys = ledger.lines.map(
      (line) =>
        `${line.journal.accountingDate.toISOString().slice(0, 10)}|${line.journal.journalNumber}|${String(line.position).padStart(4, "0")}`,
    );
    expect(keys).toEqual([...keys].sort());
    const fromDate = ledger.lines.at(-1)!.journal.accountingDate.toISOString().slice(0, 10);
    const later = await generalLedger(grni, fromDate);
    const earlier = ledger.lines.filter(
      (line) => line.journal.accountingDate.toISOString().slice(0, 10) < fromDate,
    );
    expect(later.openingBalance).toBe(
      earlier.at(-1) ? new Decimal(earlier.at(-1)!.runningBalance).toFixed(6) : "0.000000",
    );
    expect(later.lines.at(-1)?.runningBalance).toBe(ledger.lines.at(-1)?.runningBalance);
  });

  it("UX-15: customer advances are a liability and the balance sheet still balances", async () => {
    const report = await balanceSheet(reportAsOf());
    expect(new Decimal(report.difference).toFixed(2)).toBe("0.00");
    expect(new Decimal(report.customerAdvances).gte(0)).toBe(true);
    const receivable = await prisma.accountingAccountMapping.findFirstOrThrow({
      where: { mappingKey: "ACCOUNTS_RECEIVABLE" },
      include: { account: true },
    });
    for (const row of report.assetRows.filter((entry) => entry.code === receivable.account.code))
      expect(new Decimal(row.amount).gte(0)).toBe(true);
    if (new Decimal(report.customerAdvances).gt(0))
      expect(report.liabilityRows.some((row) => row.name === "Customer advances")).toBe(true);
  });
});
