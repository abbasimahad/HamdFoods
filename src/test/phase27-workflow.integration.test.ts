import Decimal from "decimal.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { AccountingMappingKey, InventoryStatus } from "@/generated/prisma/client";
import { reverseSupplierPayment } from "@/server/accounting/prisma-phase23-repository";
import { postSalesInvoiceAccounting } from "@/server/accounting/transactional-accounting-posting";
import { PrismaInventoryValuationRepository } from "@/server/costing/prisma-inventory-valuation-repository";
import { prisma } from "@/server/db/prisma";
import { PrismaGoodsReceiptRepository } from "@/server/purchasing/prisma-goods-receipt-repository";
import { PrismaSalesOrderRepository } from "@/server/sales/prisma-sales-order-repository";
import { PrismaCustomerPaymentRepository } from "@/server/sales/prisma-customer-payment-repository";
import { PrismaSalesInvoiceRepository } from "@/server/sales/prisma-sales-invoice-repository";
import { PrismaSalesReturnRepository } from "@/server/sales/prisma-sales-return-repository";
import { executePhase27GoldenWorkflow, type Phase27WorkflowState } from "./phase27-golden-workflow";

let state: Phase27WorkflowState;

beforeAll(async () => {
  state = await executePhase27GoldenWorkflow();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("Phase 27 database-backed golden workflow", () => {
  it("posts purchasing, QC, transfer, production, dispatch, invoice, and return custody exactly", async () => {
    expect(state.movementsAfterApproval).toBe(state.movementsBeforeApproval);

    const receiptMovements = await prisma.inventoryMovement.findMany({
      where: { referenceId: state.goodsReceiptId },
      select: { status: true, movementType: true, quantity: true, itemId: true },
    });
    expect(sumMovement(receiptMovements, state.rawItemId, "QUALITY_HOLD", "PURCHASE_RECEIPT")).toBe(
      "10000",
    );
    expect(sumMovement(receiptMovements, state.rawItemId, "AVAILABLE", "STATUS_IN")).toBe("9000");
    expect(sumMovement(receiptMovements, state.rawItemId, "QUARANTINE", "STATUS_IN")).toBe("1000");

    const purchaseProgress = await new PrismaGoodsReceiptRepository().getPurchaseOrderProgress(
      state.purchaseOrderId,
    );
    expect(purchaseProgress.lines.find((line) => line.itemId === state.rawItemId)).toMatchObject({
      acceptedQuantity: "9000",
      rejectedQuantity: "1000",
      remainingToFulfil: "1000",
    });
    expect(
      purchaseProgress.lines.find((line) => line.itemId === state.packagingItemId),
    ).toMatchObject({ acceptedQuantity: "100", remainingToFulfil: "0" });

    await expect(
      inventoryBalance(state.rawItemId, state.sourceWarehouseId, "AVAILABLE"),
    ).resolves.toBe("7000");
    await expect(
      inventoryBalance(state.rawItemId, state.destinationWarehouseId, "AVAILABLE"),
    ).resolves.toBe("1000");
    await expect(
      inventoryBalance(state.rawItemId, state.sourceWarehouseId, "QUARANTINE"),
    ).resolves.toBe("1000");
    await expect(
      inventoryBalance(state.packagingItemId, state.sourceWarehouseId, "AVAILABLE"),
    ).resolves.toBe("98");
    await expect(
      inventoryBalance(state.finishedItemId, state.sourceWarehouseId, "AVAILABLE"),
    ).resolves.toBe("2");
    await expect(
      inventoryBalance(state.rawItemId, state.sourceWarehouseId, "IN_PRODUCTION"),
    ).resolves.toBe("0");
    await expect(
      inventoryBalance(state.packagingItemId, state.sourceWarehouseId, "IN_PRODUCTION"),
    ).resolves.toBe("0");

    expect(state.valuationAfterTransfer).toBe(state.valuationBeforeTransfer);
    const transferMovements = await prisma.inventoryMovement.findMany({
      where: { groupId: state.transferGroupId },
      select: { quantity: true },
    });
    expect(sum(transferMovements.map((row) => row.quantity.toString())).toFixed()).toBe("0");

    const productionMovements = await prisma.inventoryMovement.findMany({
      where: { productionBatchId: state.batchId },
      select: { status: true, movementType: true, quantity: true, itemId: true },
    });
    expect(
      sumMovement(productionMovements, state.rawItemId, "IN_PRODUCTION", "PRODUCTION_ISSUE"),
    ).toBe("1000");
    expect(
      sumMovement(productionMovements, state.rawItemId, "IN_PRODUCTION", "PRODUCTION_CONSUMPTION"),
    ).toBe("-1000");
    expect(
      sumMovement(productionMovements, state.packagingItemId, "IN_PRODUCTION", "PACKAGING_ISSUE"),
    ).toBe("2");
    expect(
      sumMovement(
        productionMovements,
        state.packagingItemId,
        "IN_PRODUCTION",
        "PACKAGING_CONSUMPTION",
      ),
    ).toBe("-2");
    expect(
      sumMovement(productionMovements, state.finishedItemId, "AVAILABLE", "PRODUCTION_OUTPUT"),
    ).toBe("2");

    const salesMovements = await prisma.inventoryMovement.findMany({
      where: { salesOrderId: state.salesOrderId },
      select: { status: true, movementType: true, quantity: true, itemId: true },
    });
    expect(
      sumMovement(salesMovements, state.finishedItemId, "AVAILABLE", "SALES_RESERVATION"),
    ).toBe("-1");
    expect(sumMovement(salesMovements, state.finishedItemId, "RESERVED", "SALES_RESERVATION")).toBe(
      "1",
    );
    expect(sumMovement(salesMovements, state.finishedItemId, "RESERVED", "SALES_DISPATCH")).toBe(
      "-1",
    );
    expect(sumMovement(salesMovements, state.finishedItemId, "IN_TRANSIT", "SALES_DISPATCH")).toBe(
      "1",
    );
    expect(
      sumMovement(salesMovements, state.finishedItemId, "IN_TRANSIT", "SALES_INVOICE_OUT"),
    ).toBe("-1");
    expect(
      sumMovement(
        salesMovements,
        state.finishedItemId,
        "RETURN_INSPECTION",
        "SALES_RETURN_RECEIPT",
      ),
    ).toBe("1");
    expect(
      sumMovement(salesMovements, state.finishedItemId, "RETURN_INSPECTION", "RETURN_TO_AVAILABLE"),
    ).toBe("-1");
    expect(
      sumMovement(salesMovements, state.finishedItemId, "AVAILABLE", "RETURN_TO_AVAILABLE"),
    ).toBe("1");

    const [purchaseOrder, batch, snapshot, salesOrder, dispatch, invoice, salesReturn] =
      await Promise.all([
        prisma.purchaseOrder.findUniqueOrThrow({ where: { id: state.purchaseOrderId } }),
        prisma.productionBatch.findUniqueOrThrow({ where: { id: state.batchId } }),
        prisma.productionBatchCostSnapshot.findUniqueOrThrow({
          where: { productionBatchId: state.batchId },
        }),
        prisma.salesOrder.findUniqueOrThrow({
          where: { id: state.salesOrderId },
          include: { lines: true },
        }),
        prisma.salesDispatch.findUniqueOrThrow({ where: { id: state.dispatchId } }),
        prisma.salesInvoice.findUniqueOrThrow({
          where: { id: state.invoiceId },
          include: { lines: true },
        }),
        prisma.salesReturn.findUniqueOrThrow({ where: { id: state.salesReturnId } }),
      ]);
    expect(purchaseOrder.status).toBe("PARTIALLY_RECEIVED");
    expect(batch.status).toBe("COMPLETED");
    expect(snapshot.status).toBe("FINALIZED");
    expect(salesOrder.status).toBe("CLOSED");
    expect(dispatch.status).toBe("POSTED");
    expect(invoice.status).toBe("POSTED");
    expect(invoice.lines[0]).toMatchObject({ cartons: 0, loosePieces: 1 });
    expect(invoice.lines[0]?.totalPieces.toString()).toBe("1");
    expect(invoice.lines[0]?.pieceRate.toString()).toBe("100");
    expect(invoice.subtotal.toString()).toBe("100");
    expect(invoice.taxTotal.toString()).toBe("18");
    expect(invoice.grandTotal.toString()).toBe("118");
    expect(salesReturn.status).toBe("COMPLETED");
  });

  it("preserves customer and supplier reversal history while restoring settlement", async () => {
    const payments = new PrismaCustomerPaymentRepository();
    const customerPayment = await prisma.customerPayment.findUniqueOrThrow({
      where: { id: state.customerPaymentId },
      include: { reversalPayment: true, allocations: true },
    });
    expect(customerPayment.allocations).toHaveLength(1);
    expect(customerPayment.reversalPayment?.id).toBe(state.customerPaymentReversalId);
    const customerPaymentEntries = await prisma.customerLedgerEntry.findMany({
      where: {
        customerPaymentId: { in: [state.customerPaymentId, state.customerPaymentReversalId] },
      },
      orderBy: { entryDate: "asc" },
    });
    expect(customerPaymentEntries.map((entry) => entry.signedAmount.toString())).toEqual([
      "-50",
      "50",
    ]);
    const returnCredit = await prisma.customerLedgerEntry.findUniqueOrThrow({
      where: { salesReturnId: state.salesReturnId },
    });
    expect(returnCredit.signedAmount.toString()).toBe("-118");
    expect(await payments.getOpenInvoices(state.customerId)).toHaveLength(0);
    const invoice = await new PrismaSalesInvoiceRepository().getSalesInvoice(state.invoiceId);
    expect(invoice?.outstandingAmount).toBe("0");

    const supplierPayment = await prisma.supplierPayment.findUniqueOrThrow({
      where: { id: state.supplierPaymentId },
      include: { reversalPayment: true, allocations: true },
    });
    expect(supplierPayment.allocations).toHaveLength(1);
    expect(supplierPayment.reversalPayment?.id).toBe(state.supplierPaymentReversalId);
    const supplierPaymentEntries = await prisma.supplierPayableLedgerEntry.findMany({
      where: {
        sourceId: { in: [state.supplierPaymentId, state.supplierPaymentReversalId] },
      },
      orderBy: { entryDate: "asc" },
    });
    expect(supplierPaymentEntries.map((entry) => entry.signedAmount.toString())).toEqual([
      "-2000",
      "2000",
    ]);

    const [arAccount, apAccount, bankAccount, settlementJournals] = await Promise.all([
      mappedAccount("ACCOUNTS_RECEIVABLE"),
      mappedAccount("ACCOUNTS_PAYABLE"),
      mappedAccount("DEFAULT_BANK"),
      prisma.accountingJournal.findMany({
        where: {
          sourceId: {
            in: [
              state.customerPaymentId,
              state.customerPaymentReversalId,
              state.supplierPaymentId,
              state.supplierPaymentReversalId,
            ],
          },
        },
        include: { lines: true },
      }),
    ]);
    expectJournalLine(settlementJournals, state.customerPaymentId, bankAccount, "50", "0");
    expectJournalLine(settlementJournals, state.customerPaymentId, arAccount, "0", "50");
    expectJournalLine(settlementJournals, state.customerPaymentReversalId, bankAccount, "0", "50");
    expectJournalLine(settlementJournals, state.customerPaymentReversalId, arAccount, "50", "0");
    expectJournalLine(settlementJournals, state.supplierPaymentId, apAccount, "2000", "0");
    expectJournalLine(settlementJournals, state.supplierPaymentId, bankAccount, "0", "2000");
    expectJournalLine(
      settlementJournals,
      state.supplierPaymentReversalId,
      bankAccount,
      "2000",
      "0",
    );
    expectJournalLine(settlementJournals, state.supplierPaymentReversalId, apAccount, "0", "2000");

    await expect(
      payments.reverseCustomerPayment(
        state.customerPaymentId,
        state.actorUserId,
        new Date("2026-06-13T00:00:00.000Z"),
        "Duplicate reversal must fail.",
      ),
    ).rejects.toThrow();
    await expect(
      payments.reverseCustomerPayment(
        state.customerPaymentReversalId,
        state.actorUserId,
        new Date("2026-06-13T00:00:00.000Z"),
        "Reversal of reversal must fail.",
      ),
    ).rejects.toThrow();
    await expect(
      reverseSupplierPayment(
        state.supplierPaymentId,
        state.actorUserId,
        new Date("2026-06-13T00:00:00.000Z"),
        "Duplicate reversal must fail.",
      ),
    ).rejects.toThrow();
    await expect(
      reverseSupplierPayment(
        state.supplierPaymentReversalId,
        state.actorUserId,
        new Date("2026-06-13T00:00:00.000Z"),
        "Reversal of reversal must fail.",
      ),
    ).rejects.toThrow();
  });

  it("reconciles AR, AP, inventory, WIP, and every posted journal", async () => {
    const [arAccount, apAccount, wipAccount, bankAccount] = await Promise.all([
      mappedAccount("ACCOUNTS_RECEIVABLE"),
      mappedAccount("ACCOUNTS_PAYABLE"),
      mappedAccount("WORK_IN_PROCESS"),
      mappedAccount("DEFAULT_BANK"),
    ]);
    const [arGl, apGl, wipGl, customerLedger, supplierLedger] = await Promise.all([
      glBalance(arAccount, "debit"),
      glBalance(apAccount, "credit"),
      glBalance(wipAccount, "debit"),
      prisma.customerLedgerEntry.aggregate({
        where: { customerId: state.customerId },
        _sum: { signedAmount: true },
      }),
      prisma.supplierPayableLedgerEntry.aggregate({
        where: { supplierId: state.supplierId },
        _sum: { signedAmount: true },
      }),
    ]);
    expect(arGl.eq(customerLedger._sum.signedAmount?.toString() ?? "0")).toBe(true);
    expect(apGl.eq(supplierLedger._sum.signedAmount?.toString() ?? "0")).toBe(true);
    expect(wipGl.isZero()).toBe(true);
    expect((await glBalance(bankAccount, "debit")).isZero()).toBe(true);

    const inventoryMappingKeys: readonly AccountingMappingKey[] = [
      "RAW_MATERIAL_INVENTORY",
      "PACKAGING_INVENTORY",
      "FINISHED_GOODS_INVENTORY",
    ];
    const inventoryAccountIds = await Promise.all(inventoryMappingKeys.map(mappedAccount));
    const inventoryGl = (
      await Promise.all(inventoryAccountIds.map((accountId) => glBalance(accountId, "debit")))
    ).reduce((total, balance) => total.add(balance), new Decimal(0));
    const valuation = await prisma.inventoryValuationBalance.aggregate({
      where: { itemId: { in: [state.rawItemId, state.packagingItemId, state.finishedItemId] } },
      _sum: { inventoryValue: true },
    });
    expect(inventoryGl.eq(valuation._sum.inventoryValue?.toString() ?? "0")).toBe(true);

    const journals = await prisma.accountingJournal.findMany({
      where: { status: "POSTED" },
      include: { lines: true },
    });
    expect(journals.length).toBeGreaterThan(0);
    for (const journal of journals) {
      const debit = sum(journal.lines.map((line) => line.debit.toString()));
      const credit = sum(journal.lines.map((line) => line.credit.toString()));
      expect(debit.eq(credit)).toBe(true);
      expect(debit.eq(journal.totalDebit.toString())).toBe(true);
      expect(credit.eq(journal.totalCredit.toString())).toBe(true);
    }
  });

  it("enforces PostgreSQL append-only and posted-record immutability guards", async () => {
    const audit = await prisma.auditEvent.findFirstOrThrow();
    const journal = await prisma.accountingJournal.findFirstOrThrow({
      where: { status: "POSTED" },
    });

    await expect(
      prisma.auditEvent.update({ where: { id: audit.id }, data: { description: "tampered" } }),
    ).rejects.toThrow();
    await expect(prisma.auditEvent.delete({ where: { id: audit.id } })).rejects.toThrow();
    await expect(
      prisma.accountingJournal.update({
        where: { id: journal.id },
        data: { description: "tampered" },
      }),
    ).rejects.toThrow();
    await expect(
      prisma.customerPaymentAllocation.update({
        where: { id: state.customerPaymentAllocationId },
        data: { allocatedAmount: "1" },
      }),
    ).rejects.toThrow();
  });

  it("keeps repeated source operations idempotent or atomically rejected", async () => {
    const journalCount = await prisma.accountingJournal.count({
      where: { sourceId: state.invoiceId },
    });
    await prisma.$transaction((tx) =>
      postSalesInvoiceAccounting(tx, state.invoiceId, state.actorUserId),
    );
    expect(await prisma.accountingJournal.count({ where: { sourceId: state.invoiceId } })).toBe(
      journalCount,
    );

    const movementCount = await prisma.inventoryMovement.count({
      where: { salesOrderId: state.salesOrderId },
    });
    await expect(
      new PrismaSalesOrderRepository().approveSalesOrder(state.salesOrderId, state.actorUserId),
    ).rejects.toThrow();
    expect(
      await prisma.inventoryMovement.count({ where: { salesOrderId: state.salesOrderId } }),
    ).toBe(movementCount);

    const valuationCount = await prisma.inventoryValuationEntry.count({
      where: { productionBatchId: state.batchId },
    });
    await expect(
      new PrismaInventoryValuationRepository().finalizeBatchCost(state.batchId, state.actorUserId),
    ).rejects.toThrow();
    expect(
      await prisma.inventoryValuationEntry.count({
        where: { productionBatchId: state.batchId },
      }),
    ).toBe(valuationCount);
  });

  it("blocks over-invoicing and an over-return after the full allocation was returned", async () => {
    const invoiceLine = await prisma.salesInvoiceLine.findFirstOrThrow({
      where: { salesInvoiceId: state.invoiceId },
    });
    const allocation = await prisma.salesDispatchLotAllocation.findFirstOrThrow({
      where: { salesDispatchLine: { salesDispatchId: state.dispatchId } },
    });
    await expect(
      new PrismaSalesInvoiceRepository().createSalesInvoice({
        salesOrderId: state.salesOrderId,
        invoiceDate: "2026-06-14",
        notes: "Over-invoice must fail.",
        actorUserId: state.actorUserId,
        lines: [
          {
            salesDispatchLineId: allocation.salesDispatchLineId,
            cartons: "0",
            loosePieces: "1",
          },
        ],
      }),
    ).rejects.toThrow();
    await expect(
      new PrismaSalesReturnRepository().createSalesReturn({
        type: "INVOICED_RETURN",
        salesInvoiceId: state.invoiceId,
        salesDispatchId: state.dispatchId,
        receivingWarehouseId: state.sourceWarehouseId,
        returnDate: "2026-06-14",
        actorUserId: state.actorUserId,
        lines: [
          {
            salesInvoiceLineId: invoiceLine.id,
            salesDispatchLineId: allocation.salesDispatchLineId,
            salesDispatchAllocationId: allocation.id,
            cartons: "0",
            loosePieces: "1",
            reason: "OTHER",
          },
        ],
      }),
    ).rejects.toThrow();
  });
});

async function inventoryBalance(itemId: string, warehouseId: string, status: InventoryStatus) {
  const balance = await prisma.inventoryMovement.aggregate({
    where: { itemId, warehouseId, status },
    _sum: { quantity: true },
  });
  return new Decimal(balance._sum.quantity?.toString() ?? "0").toFixed();
}

function sum(values: readonly string[]) {
  return values.reduce((total, value) => total.add(value), new Decimal(0));
}

function sumMovement(
  movements: readonly {
    status: string;
    movementType: string;
    quantity: { toString(): string };
    itemId: string;
  }[],
  itemId: string,
  status: string,
  movementType: string,
) {
  return sum(
    movements
      .filter(
        (movement) =>
          movement.itemId === itemId &&
          movement.status === status &&
          movement.movementType === movementType,
      )
      .map((movement) => movement.quantity.toString()),
  ).toFixed();
}

async function mappedAccount(mappingKey: AccountingMappingKey) {
  return (
    await prisma.accountingAccountMapping.findUniqueOrThrow({
      where: {
        accountingSettingsId_mappingKey: {
          accountingSettingsId: "default",
          mappingKey,
        },
      },
    })
  ).accountId;
}

async function glBalance(accountId: string, normal: "debit" | "credit") {
  const result = await prisma.accountingJournalLine.aggregate({
    where: { accountId, journal: { status: "POSTED" } },
    _sum: { debit: true, credit: true },
  });
  const debit = new Decimal(result._sum.debit?.toString() ?? "0");
  const credit = new Decimal(result._sum.credit?.toString() ?? "0");
  return normal === "debit" ? debit.sub(credit) : credit.sub(debit);
}

function expectJournalLine(
  journals: readonly {
    sourceId: string;
    lines: readonly {
      accountId: string;
      debit: { toString(): string };
      credit: { toString(): string };
    }[];
  }[],
  sourceId: string,
  accountId: string,
  debit: string,
  credit: string,
) {
  const journal = journals.find((candidate) => candidate.sourceId === sourceId);
  const line = journal?.lines.find((candidate) => candidate.accountId === accountId);
  expect(line?.debit.toString()).toBe(debit);
  expect(line?.credit.toString()).toBe(credit);
}
