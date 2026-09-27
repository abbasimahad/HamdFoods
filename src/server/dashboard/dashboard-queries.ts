import "server-only";

import Decimal from "decimal.js";
import type { AccountingMappingKey } from "@/generated/prisma/client";
import { prisma } from "@/server/db/prisma";
import { todayInFactoryTimeZone } from "@/server/shared/factory-local-time";

/**
 * Live figures for the dashboard. Money comes from the posted general ledger (so it always
 * agrees with the trial balance) and operational counts come from the source documents.
 * Every query is scoped so a section is only computed for users allowed to see it.
 */

const zero = () => new Decimal(0);

function monthStart(year: number, monthIndex: number) {
  return new Date(Date.UTC(year, monthIndex, 1));
}

async function mappedAccountIds(keys: readonly AccountingMappingKey[]) {
  const mappings = await prisma.accountingAccountMapping.findMany({
    where: { accountingSettingsId: "default", mappingKey: { in: [...keys] } },
    select: { mappingKey: true, accountId: true },
  });
  return new Map(mappings.map((mapping) => [mapping.mappingKey, mapping.accountId]));
}

/** Debit-minus-credit balance of the given accounts across POSTED journals. */
async function ledgerBalance(accountIds: readonly string[]) {
  if (!accountIds.length) return zero();
  const totals = await prisma.accountingJournalLine.aggregate({
    where: { accountId: { in: [...accountIds] }, journal: { status: "POSTED" } },
    _sum: { debit: true, credit: true },
  });
  return new Decimal(totals._sum.debit?.toString() ?? "0").sub(
    totals._sum.credit?.toString() ?? "0",
  );
}

export async function financialSnapshot() {
  const ids = await mappedAccountIds([
    "ACCOUNTS_RECEIVABLE",
    "ACCOUNTS_PAYABLE",
    "RAW_MATERIAL_INVENTORY",
    "PACKAGING_INVENTORY",
    "FINISHED_GOODS_INVENTORY",
    "WORK_IN_PROCESS",
  ]);
  const treasuries = await prisma.treasuryAccount.findMany({
    where: { active: true },
    select: { glAccountId: true },
  });
  // Treasury accounts plus the default cash/bank mappings (receipts without a chosen
  // treasury account post there); a Set so a shared GL account is counted once.
  const cashAccountIds = new Set(treasuries.map((treasury) => treasury.glAccountId));
  const defaults = await mappedAccountIds(["DEFAULT_CASH", "DEFAULT_BANK"]);
  for (const id of defaults.values()) cashAccountIds.add(id);
  const pick = (...keys: AccountingMappingKey[]) =>
    keys.flatMap((key) => (ids.get(key) ? [ids.get(key)!] : []));
  const [receivables, payables, stock, cash] = await Promise.all([
    ledgerBalance(pick("ACCOUNTS_RECEIVABLE")),
    ledgerBalance(pick("ACCOUNTS_PAYABLE")),
    ledgerBalance(
      pick(
        "RAW_MATERIAL_INVENTORY",
        "PACKAGING_INVENTORY",
        "FINISHED_GOODS_INVENTORY",
        "WORK_IN_PROCESS",
      ),
    ),
    ledgerBalance([...cashAccountIds]),
  ]);
  return {
    receivables: receivables.toFixed(2),
    // AP is a credit balance; show it as a positive amount owed.
    payables: payables.negated().toFixed(2),
    stockValue: stock.toFixed(2),
    cashAndBank: cash.toFixed(2),
  };
}

export type MonthlySales = { month: string; label: string; total: string; invoices: number };

export async function salesSnapshot(months = 6) {
  const today = todayInFactoryTimeZone();
  const [year, month] = today.split("-").map(Number) as [number, number];
  const firstMonth = monthStart(year, month - months);
  const invoices = await prisma.salesInvoice.findMany({
    where: { status: "POSTED", invoiceDate: { gte: firstMonth } },
    select: {
      invoiceDate: true,
      grandTotal: true,
      subtotal: true,
      discountTotal: true,
      lines: {
        select: { itemId: true, grossAmount: true, discountAmount: true, totalPieces: true },
      },
    },
  });
  const buckets: MonthlySales[] = [];
  for (let offset = months - 1; offset >= 0; offset -= 1) {
    const start = monthStart(year, month - 1 - offset);
    const key = start.toISOString().slice(0, 7);
    buckets.push({
      month: key,
      label: start.toLocaleString("en-GB", { month: "short", timeZone: "UTC" }),
      total: "0",
      invoices: 0,
    });
  }
  const byMonth = new Map(buckets.map((bucket) => [bucket.month, bucket]));
  const thisMonthKey = today.slice(0, 7);
  const products = new Map<string, { value: Decimal; pieces: Decimal }>();
  for (const invoice of invoices) {
    const key = invoice.invoiceDate.toISOString().slice(0, 7);
    const bucket = byMonth.get(key);
    if (!bucket) continue;
    bucket.total = new Decimal(bucket.total).add(invoice.grandTotal.toString()).toFixed(2);
    bucket.invoices += 1;
    if (key !== thisMonthKey) continue;
    for (const line of invoice.lines) {
      const entry = products.get(line.itemId) ?? { value: zero(), pieces: zero() };
      entry.value = entry.value
        .add(line.grossAmount.toString())
        .sub(line.discountAmount.toString());
      entry.pieces = entry.pieces.add(line.totalPieces.toString());
      products.set(line.itemId, entry);
    }
  }
  const items = await prisma.item.findMany({
    where: { id: { in: [...products.keys()] } },
    select: { id: true, code: true, name: true },
  });
  const topProducts = [...products.entries()]
    .map(([itemId, entry]) => {
      const item = items.find((candidate) => candidate.id === itemId);
      return {
        label: item?.name ?? "Unknown item",
        code: item?.code ?? "",
        value: entry.value.toFixed(2),
        pieces: entry.pieces.toFixed(0),
      };
    })
    .sort((a, b) => new Decimal(b.value).cmp(a.value))
    .slice(0, 5);
  const current = buckets[buckets.length - 1]!;
  const previous = buckets[buckets.length - 2];
  return { monthly: buckets, current, previous, topProducts };
}

export async function productionSnapshot() {
  const batches = await prisma.productionBatch.findMany({
    where: { status: { in: ["RELEASED", "IN_PROGRESS"] } },
    select: {
      id: true,
      batchNumber: true,
      status: true,
      plannedTotalPieces: true,
      finishedGood: { select: { name: true } },
      outputTransactions: {
        where: { status: "POSTED", outputType: "GOOD" },
        select: { totalPieces: true },
      },
    },
    orderBy: { plannedProductionDate: "asc" },
    take: 6,
  });
  const [completedThisMonth, planned] = await Promise.all([
    prisma.productionBatch.count({
      where: {
        status: "COMPLETED",
        completedAt: {
          gte: new Date(`${todayInFactoryTimeZone().slice(0, 7)}-01T00:00:00.000Z`),
        },
      },
    }),
    prisma.productionBatch.count({ where: { status: { in: ["DRAFT", "PLANNED"] } } }),
  ]);
  return {
    completedThisMonth,
    planned,
    active: batches.map((batch) => {
      const produced = batch.outputTransactions.reduce(
        (total, row) => total.add(row.totalPieces?.toString() ?? "0"),
        zero(),
      );
      const plannedPieces = new Decimal(batch.plannedTotalPieces.toString());
      return {
        id: batch.id,
        batchNumber: batch.batchNumber,
        product: batch.finishedGood.name,
        status: batch.status,
        produced: produced.toFixed(0),
        planned: plannedPieces.toFixed(0),
        percent: plannedPieces.gt(0)
          ? Decimal.min(100, produced.div(plannedPieces).mul(100)).toFixed(0)
          : "0",
      };
    }),
  };
}

export async function stockAlerts() {
  const today = new Date(`${todayInFactoryTimeZone()}T00:00:00.000Z`);
  const horizon = new Date(today.getTime() + 30 * 24 * 60 * 60 * 1000);
  const [balances, expiringProduction, expiringPurchased] = await Promise.all([
    prisma.inventoryMovement.groupBy({
      by: ["itemId"],
      where: { status: "AVAILABLE" },
      _sum: { quantity: true },
    }),
    prisma.productionLot.findMany({
      where: { expiryDate: { lte: horizon } },
      select: {
        id: true,
        lotNumber: true,
        expiryDate: true,
        finishedGood: { select: { name: true } },
      },
      orderBy: { expiryDate: "asc" },
      take: 40,
    }),
    prisma.inventoryLot.findMany({
      where: { expiryDate: { lte: horizon } },
      select: {
        id: true,
        supplierLotNumber: true,
        expiryDate: true,
        item: { select: { name: true } },
        sourceGoodsReceipt: { select: { number: true } },
      },
      orderBy: { expiryDate: "asc" },
      take: 40,
    }),
  ]);
  const outOfStockIds = balances
    .filter((row) => new Decimal(row._sum.quantity?.toString() ?? "0").lte(0))
    .map((row) => row.itemId);
  const outOfStock = await prisma.item.findMany({
    where: { id: { in: outOfStockIds }, active: true },
    select: { id: true, code: true, name: true },
    take: 8,
  });
  // Only lots that still hold stock are worth flagging.
  const lotBalances = await prisma.inventoryMovement.groupBy({
    by: ["productionLotId", "inventoryLotId"],
    where: {
      OR: [
        { productionLotId: { in: expiringProduction.map((lot) => lot.id) } },
        { inventoryLotId: { in: expiringPurchased.map((lot) => lot.id) } },
      ],
      status: { in: ["AVAILABLE", "QUARANTINE"] },
    },
    _sum: { quantity: true },
  });
  const held = (column: "productionLotId" | "inventoryLotId", id: string) =>
    lotBalances
      .filter((row) => row[column] === id)
      .reduce((total, row) => total.add(row._sum.quantity?.toString() ?? "0"), zero());
  const expiring = [
    ...expiringProduction
      .filter((lot) => held("productionLotId", lot.id).gt(0))
      .map((lot) => ({
        id: lot.id,
        lot: lot.lotNumber,
        item: lot.finishedGood.name,
        expiryDate: lot.expiryDate!,
      })),
    ...expiringPurchased
      .filter((lot) => held("inventoryLotId", lot.id).gt(0))
      .map((lot) => ({
        id: lot.id,
        lot: lot.supplierLotNumber ?? lot.sourceGoodsReceipt.number,
        item: lot.item.name,
        expiryDate: lot.expiryDate!,
      })),
  ]
    .sort((a, b) => a.expiryDate.getTime() - b.expiryDate.getTime())
    .slice(0, 8)
    .map((lot) => ({
      ...lot,
      expired: lot.expiryDate < today,
      daysLeft: Math.round((lot.expiryDate.getTime() - today.getTime()) / 86_400_000),
    }));
  return { outOfStock, expiring };
}

export async function pendingWork(permissions: {
  sales: boolean;
  purchasing: boolean;
  production: boolean;
  accounting: boolean;
}) {
  const count = (enabled: boolean, query: () => Promise<number>) =>
    enabled ? query() : Promise.resolve(null);
  const [
    ordersToApprove,
    grnsAwaitingQc,
    draftInvoices,
    draftReceipts,
    batchesToRelease,
    draftSupplierInvoices,
  ] = await Promise.all([
    count(permissions.sales, () => prisma.salesOrder.count({ where: { status: "DRAFT" } })),
    count(permissions.purchasing, () => prisma.goodsReceipt.count({ where: { status: "POSTED" } })),
    count(permissions.sales, () => prisma.salesInvoice.count({ where: { status: "DRAFT" } })),
    count(permissions.sales || permissions.accounting, () =>
      prisma.customerPayment.count({ where: { status: "DRAFT" } }),
    ),
    count(permissions.production, () =>
      prisma.productionBatch.count({ where: { status: { in: ["DRAFT", "PLANNED"] } } }),
    ),
    count(permissions.purchasing || permissions.accounting, () =>
      prisma.purchaseInvoice.count({ where: { status: "DRAFT" } }),
    ),
  ]);
  return [
    {
      label: "Sales orders to approve",
      count: ordersToApprove,
      href: "/sales/orders?status=DRAFT",
    },
    {
      label: "Goods receipts awaiting QC",
      count: grnsAwaitingQc,
      href: "/purchasing/goods-receiving",
    },
    { label: "Draft sales invoices", count: draftInvoices, href: "/sales/invoices" },
    {
      label: "Draft customer receipts",
      count: draftReceipts,
      href: "/sales/payments?status=DRAFT",
    },
    { label: "Batches to release", count: batchesToRelease, href: "/production/batches" },
    {
      label: "Draft supplier invoices",
      count: draftSupplierInvoices,
      href: "/purchasing/purchase-invoices",
    },
  ].filter(
    (entry): entry is { label: string; count: number; href: string } => entry.count !== null,
  );
}

export async function recentActivity(limit = 8) {
  return prisma.auditEvent.findMany({
    select: {
      id: true,
      occurredAt: true,
      description: true,
      entityReference: true,
      module: true,
      actor: { select: { name: true } },
    },
    orderBy: { occurredAt: "desc" },
    take: limit,
  });
}
