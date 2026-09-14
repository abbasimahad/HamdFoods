import Decimal from "decimal.js";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { prisma } from "@/server/db/prisma";
import { PrismaPurchasingRepository } from "@/server/purchasing/prisma-purchasing-repository";
import { PrismaPurchaseInvoiceRepository } from "@/server/purchasing/prisma-purchase-invoice-repository";
import { PurchasingRepositoryError } from "@/modules/purchasing/application/contracts";
import { executePhase27GoldenWorkflow } from "./phase27-golden-workflow";

type Fixture = {
  supplierId: string;
  actorUserId: string;
  po: Record<string, { purchaseOrderLineId: string; itemId: string }>;
  grn: Record<string, string>; // scenario key -> goodsReceiptLineId
  preGrnPoLineId: string;
};

let fixture: Fixture;
const repo = new PrismaPurchaseInvoiceRepository();

/**
 * Creates an already-QC-accepted goods receipt line without going through
 * the real receiving/QC/valuation posting engines -- so it never touches
 * the shared RAW_MATERIAL_INVENTORY GL account, GRNI, or AP, which other
 * integration tests (and other Purchase Invoice fixtures sharing the
 * golden-workflow supplier) assert exact totals against. This inserts
 * exactly the rows Purchase Invoice code actually reads (GoodsReceipt at
 * QC_COMPLETED, its line, the QC decision, and a FINAL GRN-COST valuation
 * entry carrying unitCost) and nothing else -- no InventoryLot, no
 * InventoryMovement, no journal, no InventoryValuationBalance mutation.
 * Every row respects the same DB guard triggers a real receipt would
 * (goods_receipt_qc_reconciliation requires the parent to be POSTED at
 * insert time; the header is then moved POSTED -> QC_COMPLETED exactly as
 * enforce_goods_receipt_lifecycle() allows).
 */
async function createAcceptedGrnLine(params: {
  purchaseOrderId: string;
  supplierId: string;
  warehouseId: string;
  purchaseOrderLineId: string;
  itemId: string;
  unitId: string;
  quantity: string;
  unitCost: string;
  actorUserId: string;
  receiptNumber: string;
  receiptDate: Date;
}) {
  const receipt = await prisma.goodsReceipt.create({
    data: {
      number: params.receiptNumber,
      purchaseOrderId: params.purchaseOrderId,
      supplierId: params.supplierId,
      receiptDate: params.receiptDate,
      warehouseId: params.warehouseId,
      status: "POSTED",
      purpose: "PURCHASE",
      receivedByUserId: params.actorUserId,
      postedByUserId: params.actorUserId,
      postedAt: params.receiptDate,
      lines: {
        create: [
          {
            position: 1,
            purchaseOrderLineId: params.purchaseOrderLineId,
            itemId: params.itemId,
            enteredQuantity: params.quantity,
            enteredUnitId: params.unitId,
            normalizedQuantity: params.quantity,
            canonicalUnitId: params.unitId,
          },
        ],
      },
    },
    include: { lines: true },
  });
  const receiptLine = receipt.lines[0]!;
  await prisma.goodsReceiptQcDecision.create({
    data: {
      goodsReceiptLineId: receiptLine.id,
      acceptedQuantity: params.quantity,
      rejectedQuantity: "0",
    },
  });
  await prisma.goodsReceipt.update({
    where: { id: receipt.id },
    data: {
      status: "QC_COMPLETED",
      qcByUserId: params.actorUserId,
      qcCompletedAt: params.receiptDate,
    },
  });
  const value = new Decimal(params.unitCost).mul(params.quantity).toFixed(6);
  await prisma.inventoryValuationEntry.create({
    data: {
      sourceKey: `GRN-COST:${receiptLine.id}`,
      itemId: params.itemId,
      entryType: "PURCHASE_RECEIPT",
      state: "FINAL",
      valuationMethod: "MOVING_WEIGHTED_AVERAGE",
      effectiveAt: params.receiptDate,
      quantityEffect: params.quantity,
      unitCost: params.unitCost,
      valueDelta: value,
      runningOwnedQuantity: params.quantity,
      runningInventoryValue: value,
      resultingAverageUnitCost: params.unitCost,
      sourceType: "GOODS_RECEIPT",
      sourceId: receipt.id,
      sourceNumber: receipt.number,
      createdByUserId: params.actorUserId,
    },
  });
  return { goodsReceiptId: receipt.id, goodsReceiptLineId: receiptLine.id };
}

beforeAll(async () => {
  const state = await executePhase27GoldenWorkflow();
  const grams = await prisma.unit.findUniqueOrThrow({ where: { code: "G" } });
  const purchasing = new PrismaPurchasingRepository();

  // Dedicated item/category/warehouse -- never the shared golden-workflow raw
  // item/warehouse, whose InventoryMovement/InventoryValuationBalance other
  // integration tests assert exact totals against.
  const category = await prisma.itemCategory.upsert({
    where: { code: "PI-TEST-CAT" },
    create: {
      code: "PI-TEST-CAT",
      name: "Purchase Invoice Test Category",
      itemType: "RAW_MATERIAL",
    },
    update: {},
  });
  const raw = await prisma.item.upsert({
    where: { code: "PI-TEST-RAW" },
    create: {
      code: "PI-TEST-RAW",
      name: "Purchase Invoice Test Raw Material",
      itemType: "RAW_MATERIAL",
      categoryId: category.id,
      stockUnitId: grams.id,
    },
    update: {},
  });
  const warehouse = await prisma.warehouse.upsert({
    where: { code: "PI-TEST-WH" },
    create: { code: "PI-TEST-WH", name: "Purchase Invoice Test Warehouse" },
    update: {},
  });

  const scenarioKeys = [
    "exact",
    "posVar",
    "negVar",
    "taxVar",
    "incomplete",
    "partial",
    "duplicate",
    "concurrent",
    "closedPost",
    "closedReverse",
  ] as const;

  const purchaseOrderId = await purchasing.createPurchaseOrder({
    supplierId: state.supplierId,
    orderDate: "2026-07-01",
    actorUserId: state.actorUserId,
    lines: [
      ...scenarioKeys.map(() => ({
        itemId: raw.id,
        quantity: "100",
        unitId: grams.id,
        unitRate: "5",
        discountPercent: "0",
        taxPercent: "10",
      })),
      {
        itemId: raw.id,
        quantity: "200",
        unitId: grams.id,
        unitRate: "5",
        discountPercent: "0",
        taxPercent: "10",
      }, // multiGrn
      {
        itemId: raw.id,
        quantity: "100",
        unitId: grams.id,
        unitRate: "5",
        discountPercent: "0",
        taxPercent: "10",
      }, // preGrn
    ],
  });
  await purchasing.approvePurchaseOrder(purchaseOrderId, state.actorUserId);
  const order = await purchasing.getPurchaseOrder(purchaseOrderId);
  if (!order) throw new Error("Fixture purchase order was not created.");
  const orderedLines = order.lines;
  const po: Fixture["po"] = {};
  scenarioKeys.forEach((key, index) => {
    po[key] = { purchaseOrderLineId: orderedLines[index]!.id, itemId: raw.id };
  });
  const multiGrnLine = orderedLines[scenarioKeys.length]!;
  const preGrnLine = orderedLines[scenarioKeys.length + 1]!;

  const grn: Fixture["grn"] = {};
  for (const key of scenarioKeys) {
    const { goodsReceiptLineId } = await createAcceptedGrnLine({
      purchaseOrderId,
      supplierId: state.supplierId,
      warehouseId: warehouse.id,
      purchaseOrderLineId: po[key]!.purchaseOrderLineId,
      itemId: raw.id,
      unitId: grams.id,
      quantity: "100",
      unitCost: "5",
      actorUserId: state.actorUserId,
      receiptNumber: `PI-FIXTURE-${key}`,
      receiptDate: new Date("2026-07-05T00:00:00.000Z"),
    });
    grn[key] = goodsReceiptLineId;
  }

  // multi-GRN: two separate receipts of 100 each against the same 200-qty PO line.
  for (const [index, deliveryTag] of ["A", "B"].entries()) {
    const { goodsReceiptLineId } = await createAcceptedGrnLine({
      purchaseOrderId,
      supplierId: state.supplierId,
      warehouseId: warehouse.id,
      purchaseOrderLineId: multiGrnLine.id,
      itemId: raw.id,
      unitId: grams.id,
      quantity: "100",
      unitCost: "5",
      actorUserId: state.actorUserId,
      receiptNumber: `PI-FIXTURE-MULTI-${deliveryTag}`,
      receiptDate: new Date("2026-07-06T00:00:00.000Z"),
    });
    grn[`multiGrn${index}`] = goodsReceiptLineId;
  }
  po.multiGrn = { purchaseOrderLineId: multiGrnLine.id, itemId: raw.id };
  po.preGrn = { purchaseOrderLineId: preGrnLine.id, itemId: raw.id };

  // Stable, present-but-inert valuation balance for the dedicated item, so
  // "no revaluation" assertions have a real before/after baseline to compare.
  await prisma.inventoryValuationBalance.upsert({
    where: { itemId: raw.id },
    create: {
      itemId: raw.id,
      ownedQuantity: "1400",
      inventoryValue: "7000",
      averageUnitCost: "5",
      lastValuationAt: new Date("2026-07-06T00:00:00.000Z"),
    },
    update: {},
  });

  fixture = {
    supplierId: state.supplierId,
    actorUserId: state.actorUserId,
    po,
    grn,
    preGrnPoLineId: preGrnLine.id,
  };
});

function line(
  scenario: string,
  overrides: Partial<{ invoicedUnitRate: string; taxPercent: string }> = {},
  matched = "100",
) {
  return {
    purchaseOrderLineId: fixture.po[scenario]!.purchaseOrderLineId,
    invoicedQuantity: "100",
    invoicedUnitRate: overrides.invoicedUnitRate ?? "5",
    taxPercent: overrides.taxPercent ?? "10",
    matches: fixture.grn[scenario]
      ? [{ goodsReceiptLineId: fixture.grn[scenario]!, matchedQuantity: matched }]
      : [],
  };
}

async function createInvoice(
  supplierInvoiceNumber: string,
  lines: readonly ReturnType<typeof line>[],
  invoiceDate = "2026-07-10",
) {
  return repo.createPurchaseInvoice({
    supplierId: fixture.supplierId,
    supplierInvoiceNumber,
    invoiceDate,
    lines,
    actorUserId: fixture.actorUserId,
  });
}

describe("purchase invoice: exact match", () => {
  it("posts no journal or ledger entry, then reverses with no fabricated accounting", async () => {
    const journalsBefore = await prisma.accountingJournal.count();
    const ledgerBefore = await prisma.supplierPayableLedgerEntry.count();
    const id = await createInvoice("EXACT-001", [line("exact")]);

    await repo.postPurchaseInvoice(id, fixture.actorUserId);
    const posted = await repo.getPurchaseInvoice(id);
    expect(posted?.status).toBe("POSTED");
    expect(posted?.priceVarianceTotal).toBe("0.000000");
    expect(posted?.taxVarianceTotal).toBe("0.000000");
    expect(await prisma.accountingJournal.count()).toBe(journalsBefore);
    expect(await prisma.supplierPayableLedgerEntry.count()).toBe(ledgerBefore);

    // Immutability: posted header/line/match content cannot be mutated directly.
    await expect(
      prisma.purchaseInvoice.update({ where: { id }, data: { supplierInvoiceNumber: "HACKED" } }),
    ).rejects.toThrow();
    const postedLine = posted!.lines[0]!;
    await expect(
      prisma.purchaseInvoiceLine.update({
        where: { id: postedLine.id },
        data: { invoicedQuantity: "999" },
      }),
    ).rejects.toThrow();
    await expect(
      prisma.purchaseInvoiceLineMatch.update({
        where: { id: postedLine.matches[0]!.id },
        data: { matchedQuantity: "999" },
      }),
    ).rejects.toThrow();

    // Audit trail.
    expect(
      await prisma.auditEvent.count({
        where: { entityType: "PURCHASE_INVOICE", entityId: id, action: "POST" },
      }),
    ).toBe(1);

    // Duplicate POST is idempotent -- nothing doubles.
    await expect(repo.postPurchaseInvoice(id, fixture.actorUserId)).rejects.toThrow(
      PurchasingRepositoryError,
    );
    expect(await prisma.accountingJournal.count()).toBe(journalsBefore);

    // Reverse: no journal existed, so reversal is a pure status flip.
    await repo.reversePurchaseInvoice(
      id,
      "Integration test exact-match reversal.",
      fixture.actorUserId,
    );
    const reversed = await repo.getPurchaseInvoice(id);
    expect(reversed?.status).toBe("REVERSED");
    expect(await prisma.accountingJournal.count()).toBe(journalsBefore);
    expect(await prisma.supplierPayableLedgerEntry.count()).toBe(ledgerBefore);
    expect(
      await prisma.auditEvent.count({
        where: { entityType: "PURCHASE_INVOICE", entityId: id, action: "REVERSE" },
      }),
    ).toBe(1);

    // Duplicate REVERSE is idempotent.
    await expect(
      repo.reversePurchaseInvoice(id, "Second attempt.", fixture.actorUserId),
    ).rejects.toThrow(PurchasingRepositoryError);
  });
});

describe("purchase invoice: price variance", () => {
  it("posts a balanced true-up journal for a positive variance, then reverses it exactly", async () => {
    const apAccountId = await mappedAccountId("ACCOUNTS_PAYABLE");
    const priceVarianceAccountId = await mappedAccountId("PURCHASE_PRICE_VARIANCE");
    const apBalanceBefore = await glBalance(apAccountId);
    const valuationBefore = await prisma.inventoryValuationBalance.findUniqueOrThrow({
      where: { itemId: fixture.po.posVar!.itemId },
    });
    const valuationEntriesBefore = await prisma.inventoryValuationEntry.count();

    // Rate 6 vs GRN-derived cost 5 -> price variance 100. Because tax is a
    // percentage of price, and the invoice's own tax is computed on its
    // (higher) invoiced price while the GRN-derived tax basis is computed on
    // the GRN's own cost, a price variance at matching tax% also induces a
    // proportional tax variance: invoice tax = 6*100*10% = 60; GRN-derived
    // tax = 5*100*50/500 = 50; tax variance = 10. Net AP true-up = 110.
    const id = await createInvoice("POSVAR-001", [line("posVar", { invoicedUnitRate: "6" })]);
    await repo.postPurchaseInvoice(id, fixture.actorUserId);
    const posted = await repo.getPurchaseInvoice(id);
    expect(posted?.priceVarianceTotal).toBe("100.000000");
    expect(posted?.taxVarianceTotal).toBe("10.000000");

    const journal = await prisma.accountingJournal.findUniqueOrThrow({
      where: { sourceType_sourceId: { sourceType: "PURCHASE_INVOICE_VARIANCE", sourceId: id } },
      include: { lines: true },
    });
    const totalDebit = sumDecimal(journal.lines.map((l) => l.debit.toString()));
    const totalCredit = sumDecimal(journal.lines.map((l) => l.credit.toString()));
    expect(totalDebit).toBe(totalCredit); // balanced journal
    expect(totalDebit).toBe("110.000000");
    expect(
      journal.lines.some((l) => l.accountId === priceVarianceAccountId && Number(l.debit) === 100),
    ).toBe(true);
    const inputTaxAccountId = await mappedAccountId("INPUT_TAX");
    expect(
      journal.lines.some((l) => l.accountId === inputTaxAccountId && Number(l.debit) === 10),
    ).toBe(true);
    expect(journal.lines.some((l) => l.accountId === apAccountId && Number(l.credit) === 110)).toBe(
      true,
    );

    const ledgerEntry = await prisma.supplierPayableLedgerEntry.findUniqueOrThrow({
      where: { sourceKey: `PURCHASE_INVOICE_VARIANCE:${id}` },
    });
    expect(ledgerEntry.entryType).toBe("PURCHASE_INVOICE_VARIANCE");
    expect(ledgerEntry.signedAmount.toFixed(6)).toBe("110.000000");

    // No GRNI movement and no inventory revaluation from a price variance true-up.
    expect(await prisma.inventoryValuationEntry.count()).toBe(valuationEntriesBefore);
    const valuationAfter = await prisma.inventoryValuationBalance.findUniqueOrThrow({
      where: { itemId: fixture.po.posVar!.itemId },
    });
    expect(valuationAfter.averageUnitCost?.toString()).toBe(
      valuationBefore.averageUnitCost?.toString(),
    );
    expect(valuationAfter.inventoryValue.toString()).toBe(
      valuationBefore.inventoryValue.toString(),
    );

    // AP is a credit-normal liability; crediting it by the net variance
    // moves debit-minus-credit further negative.
    expect((await glBalance(apAccountId)).toFixed(6)).toBe(apBalanceBefore.sub(110).toFixed(6));

    await repo.reversePurchaseInvoice(
      id,
      "Integration test variance reversal.",
      fixture.actorUserId,
    );
    const reversalJournal = await prisma.accountingJournal.findUniqueOrThrow({
      where: {
        sourceType_sourceId: {
          sourceType: "PURCHASE_INVOICE_REVERSAL",
          sourceId: `reversal:${id}`,
        },
      },
      include: { lines: true },
    });
    const reversalDebit = sumDecimal(reversalJournal.lines.map((l) => l.debit.toString()));
    expect(reversalDebit).toBe("110.000000");
    expect((await glBalance(apAccountId)).toFixed(6)).toBe(apBalanceBefore.toFixed(6));
    const reversalLedger = await prisma.supplierPayableLedgerEntry.findUniqueOrThrow({
      where: { sourceKey: `PURCHASE_INVOICE_REVERSAL:${id}` },
    });
    expect(reversalLedger.signedAmount.toFixed(6)).toBe("-110.000000");

    // Original journal/ledger/matches are untouched -- only new compensating rows were added.
    expect(
      (
        await prisma.accountingJournal.findUniqueOrThrow({
          where: { sourceType_sourceId: { sourceType: "PURCHASE_INVOICE_VARIANCE", sourceId: id } },
        })
      ).status,
    ).toBe("POSTED");
  });

  it("posts a balanced true-up journal for a negative variance", async () => {
    // Rate 4 vs GRN-derived cost 5 -> price variance -100. Invoice tax =
    // 4*100*10% = 40; GRN-derived tax = 50; tax variance = -10. Net AP
    // true-up = -110 (see the positive-variance test above for the full
    // derivation of why matching tax% still yields a nonzero tax variance).
    const id = await createInvoice("NEGVAR-001", [line("negVar", { invoicedUnitRate: "4" })]);
    await repo.postPurchaseInvoice(id, fixture.actorUserId);
    const posted = await repo.getPurchaseInvoice(id);
    expect(posted?.priceVarianceTotal).toBe("-100.000000");
    expect(posted?.taxVarianceTotal).toBe("-10.000000");
    const journal = await prisma.accountingJournal.findUniqueOrThrow({
      where: { sourceType_sourceId: { sourceType: "PURCHASE_INVOICE_VARIANCE", sourceId: id } },
      include: { lines: true },
    });
    const apAccountId = await mappedAccountId("ACCOUNTS_PAYABLE");
    const inputTaxAccountId = await mappedAccountId("INPUT_TAX");
    expect(journal.lines.some((l) => l.accountId === apAccountId && Number(l.debit) === 110)).toBe(
      true,
    );
    expect(
      journal.lines.some((l) => l.accountId === inputTaxAccountId && Number(l.credit) === 10),
    ).toBe(true);
    const ledgerEntry = await prisma.supplierPayableLedgerEntry.findUniqueOrThrow({
      where: { sourceKey: `PURCHASE_INVOICE_VARIANCE:${id}` },
    });
    expect(ledgerEntry.signedAmount.toFixed(6)).toBe("-110.000000");
  });
});

describe("purchase invoice: tax variance", () => {
  it("posts a true-up against INPUT_TAX under RECOVERABLE treatment", async () => {
    const id = await createInvoice("TAXVAR-001", [line("taxVar", { taxPercent: "15" })]);
    await repo.postPurchaseInvoice(id, fixture.actorUserId);
    const posted = await repo.getPurchaseInvoice(id);
    expect(posted?.priceVarianceTotal).toBe("0.000000");
    expect(posted?.taxVarianceTotal).toBe("25.000000");
    const journal = await prisma.accountingJournal.findUniqueOrThrow({
      where: { sourceType_sourceId: { sourceType: "PURCHASE_INVOICE_VARIANCE", sourceId: id } },
      include: { lines: true },
    });
    const inputTaxAccountId = await mappedAccountId("INPUT_TAX");
    expect(
      journal.lines.some((l) => l.accountId === inputTaxAccountId && Number(l.debit) === 25),
    ).toBe(true);
  });

  it("blocks (does not throw) when tax policy is NOT_CONFIGURED for a nonzero tax variance", async () => {
    await prisma.accountingSettings.update({
      where: { id: "default" },
      data: { purchaseTaxTreatment: "NOT_CONFIGURED" },
    });
    try {
      const id = await createInvoice("TAXBLOCK-001", [line("exact", { taxPercent: "15" })]);
      await repo.postPurchaseInvoice(id, fixture.actorUserId);
      const posted = await repo.getPurchaseInvoice(id);
      expect(posted?.status).toBe("POSTED");
      expect(
        await prisma.accountingJournal.count({
          where: { sourceType: "PURCHASE_INVOICE_VARIANCE", sourceId: id },
        }),
      ).toBe(0);
      const block = await prisma.accountingPostingBlock.findUniqueOrThrow({
        where: { sourceKey: `PURCHASE_INVOICE_VARIANCE:${id}` },
      });
      expect(block.reasonCode).toBe("PURCHASE_TAX_NOT_CONFIGURED");
    } finally {
      await prisma.accountingSettings.update({
        where: { id: "default" },
        data: { purchaseTaxTreatment: "RECOVERABLE" },
      });
    }
  });
});

describe("purchase invoice: matching", () => {
  it("blocks POST while a line is incompletely matched (zero tolerance)", async () => {
    const id = await createInvoice("INCOMPLETE-001", [line("incomplete", {}, "40")]);
    await expect(repo.postPurchaseInvoice(id, fixture.actorUserId)).rejects.toThrow(
      /not fully matched/,
    );
    expect((await repo.getPurchaseInvoice(id))?.status).toBe("DRAFT");
  });

  it("supports partial invoicing across multiple invoices against one GRN line", async () => {
    const first = await createInvoice("PARTIAL-001", [
      { ...line("partial", {}, "60"), invoicedQuantity: "60" },
    ]);
    await repo.postPurchaseInvoice(first, fixture.actorUserId);
    expect((await repo.getPurchaseInvoice(first))?.status).toBe("POSTED");

    const second = await createInvoice("PARTIAL-002", [
      { ...line("partial", {}, "40"), invoicedQuantity: "40" },
    ]);
    await repo.postPurchaseInvoice(second, fixture.actorUserId);
    expect((await repo.getPurchaseInvoice(second))?.status).toBe("POSTED");

    // The GRN line's accepted balance (100) is now fully claimed by POSTED invoices.
    const third = await createInvoice("PARTIAL-003", [
      { ...line("partial", {}, "1"), invoicedQuantity: "1" },
    ]);
    await expect(repo.postPurchaseInvoice(third, fixture.actorUserId)).rejects.toThrow(/exceeds/);
  });

  it("matches one invoice line across two separate goods receipt lines (multi-GRN)", async () => {
    const id = await createInvoice("MULTIGRN-001", [
      {
        purchaseOrderLineId: fixture.po.multiGrn!.purchaseOrderLineId,
        invoicedQuantity: "200",
        invoicedUnitRate: "5",
        taxPercent: "10",
        matches: [
          { goodsReceiptLineId: fixture.grn.multiGrn0!, matchedQuantity: "100" },
          { goodsReceiptLineId: fixture.grn.multiGrn1!, matchedQuantity: "100" },
        ],
      },
    ]);
    await repo.postPurchaseInvoice(id, fixture.actorUserId);
    const posted = await repo.getPurchaseInvoice(id);
    expect(posted?.status).toBe("POSTED");
    expect(posted?.lines[0]?.matches).toHaveLength(2);
    expect(posted?.priceVarianceTotal).toBe("0.000000");
  });

  it("rejects a duplicate supplier invoice number for the same supplier", async () => {
    await createInvoice("DUP-001", [line("duplicate")]);
    await expect(createInvoice("DUP-001", [line("duplicate")])).rejects.toThrow(/already exists/);
  });
});

describe("purchase invoice: pre-GRN draft", () => {
  it("saves a draft with zero matches and blocks POST until a GRN line is matched", async () => {
    const id = await createInvoice("PREGRN-001", [
      {
        purchaseOrderLineId: fixture.preGrnPoLineId,
        invoicedQuantity: "100",
        invoicedUnitRate: "5",
        taxPercent: "10",
        matches: [],
      },
    ]);
    const draft = await repo.getPurchaseInvoice(id);
    expect(draft?.status).toBe("DRAFT");
    expect(draft?.lines[0]?.matches).toHaveLength(0);
    await expect(repo.postPurchaseInvoice(id, fixture.actorUserId)).rejects.toThrow(/matched/);

    // A GRN now arrives for that PO line.
    const grams = await prisma.unit.findUniqueOrThrow({ where: { code: "G" } });
    const warehouse = await prisma.warehouse.findUniqueOrThrow({ where: { code: "PI-TEST-WH" } });
    const purchaseOrderLine = await prisma.purchaseOrderLine.findUniqueOrThrow({
      where: { id: fixture.preGrnPoLineId },
      include: { purchaseOrder: true },
    });
    const { goodsReceiptLineId } = await createAcceptedGrnLine({
      purchaseOrderId: purchaseOrderLine.purchaseOrderId,
      supplierId: purchaseOrderLine.purchaseOrder.supplierId,
      warehouseId: warehouse.id,
      purchaseOrderLineId: fixture.preGrnPoLineId,
      itemId: purchaseOrderLine.itemId,
      unitId: grams.id,
      quantity: "100",
      unitCost: "5",
      actorUserId: fixture.actorUserId,
      receiptNumber: "PI-FIXTURE-PREGRN",
      receiptDate: new Date("2026-07-08T00:00:00.000Z"),
    });

    await repo.updatePurchaseInvoice({
      id,
      supplierId: fixture.supplierId,
      supplierInvoiceNumber: "PREGRN-001",
      invoiceDate: "2026-07-10",
      lines: [
        {
          purchaseOrderLineId: fixture.preGrnPoLineId,
          invoicedQuantity: "100",
          invoicedUnitRate: "5",
          taxPercent: "10",
          matches: [{ goodsReceiptLineId, matchedQuantity: "100" }],
        },
      ],
      actorUserId: fixture.actorUserId,
    });
    await repo.postPurchaseInvoice(id, fixture.actorUserId);
    expect((await repo.getPurchaseInvoice(id))?.status).toBe("POSTED");
  });
});

describe("purchase invoice: concurrency", () => {
  it("does not allow two concurrent invoices to together over-invoice one GRN line", async () => {
    const first = await createInvoice("CONCURRENT-A", [line("concurrent")]);
    const second = await createInvoice("CONCURRENT-B", [line("concurrent")]);

    const results = await Promise.allSettled([
      repo.postPurchaseInvoice(first, fixture.actorUserId),
      repo.postPurchaseInvoice(second, fixture.actorUserId),
    ]);
    const fulfilled = results.filter((result) => result.status === "fulfilled");
    const rejected = results.filter((result) => result.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    const [firstRecord, secondRecord] = await Promise.all([
      repo.getPurchaseInvoice(first),
      repo.getPurchaseInvoice(second),
    ]);
    const postedCount = [firstRecord, secondRecord].filter((r) => r?.status === "POSTED").length;
    expect(postedCount).toBe(1);
  });
});

describe("purchase invoice: closed period", () => {
  it("blocks (does not throw) posting a variance dated outside any OPEN accounting period", async () => {
    const id = await createInvoice(
      "CLOSEDPOST-001",
      [line("closedPost", { invoicedUnitRate: "6" })],
      "2027-01-15",
    );
    await repo.postPurchaseInvoice(id, fixture.actorUserId);
    const posted = await repo.getPurchaseInvoice(id);
    expect(posted?.status).toBe("POSTED");
    expect(
      await prisma.accountingJournal.count({
        where: { sourceType: "PURCHASE_INVOICE_VARIANCE", sourceId: id },
      }),
    ).toBe(0);
    const block = await prisma.accountingPostingBlock.findUniqueOrThrow({
      where: { sourceKey: `PURCHASE_INVOICE_VARIANCE:${id}` },
    });
    expect(block.reasonCode).toBe("CLOSED_ACCOUNTING_PERIOD");
  });

  it("throws (does not silently block) reversing a variance invoice when no OPEN period covers the reversal date", async () => {
    const id = await createInvoice("CLOSEDREV-001", [
      line("closedReverse", { invoicedUnitRate: "6" }),
    ]);
    await repo.postPurchaseInvoice(id, fixture.actorUserId);
    expect((await repo.getPurchaseInvoice(id))?.status).toBe("POSTED");

    vi.useFakeTimers();
    vi.setSystemTime(new Date("2027-03-01T00:00:00.000Z"));
    try {
      await expect(
        repo.reversePurchaseInvoice(id, "Attempted out-of-period reversal.", fixture.actorUserId),
      ).rejects.toThrow(/OPEN accounting period/);
    } finally {
      vi.useRealTimers();
    }
    expect((await repo.getPurchaseInvoice(id))?.status).toBe("POSTED");
  });
});

afterEach(() => {
  vi.useRealTimers();
});

async function mappedAccountId(mappingKey: string) {
  const mapping = await prisma.accountingAccountMapping.findUniqueOrThrow({
    where: {
      accountingSettingsId_mappingKey: {
        accountingSettingsId: "default",
        mappingKey: mappingKey as never,
      },
    },
  });
  return mapping.accountId;
}
async function glBalance(accountId: string) {
  const result = await prisma.accountingJournalLine.aggregate({
    where: { accountId, journal: { status: "POSTED" } },
    _sum: { debit: true, credit: true },
  });
  return new Decimal(result._sum.debit?.toString() ?? "0").sub(
    result._sum.credit?.toString() ?? "0",
  );
}
function sumDecimal(values: readonly string[]) {
  return values.reduce((total, value) => total.add(value), new Decimal(0)).toFixed(6);
}
