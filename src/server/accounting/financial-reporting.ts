import "server-only";

import Decimal from "decimal.js";
import {
  effectiveCustomerPaymentWhere,
  effectiveSupplierPaymentWhere,
} from "@/server/accounting/payment-effectiveness";
import { customerInvoiceSettlement } from "@/server/sales/customer-invoice-settlement";
import { prisma } from "@/server/db/prisma";

export type ReportRange = { from: Date; to: Date };
type BalanceRow = {
  id: string;
  code: string;
  name: string;
  accountType: string;
  subtype: string | null;
  balance: Decimal;
};
const zero = () => new Decimal(0);
const format = (value: Decimal) => value.toFixed(6);
const net = (lines: readonly { debit: { toString(): string }; credit: { toString(): string } }[]) =>
  lines.reduce((sum, line) => sum.add(line.debit.toString()).sub(line.credit.toString()), zero());
const normal = (account: BalanceRow) =>
  ["LIABILITY", "EQUITY", "REVENUE"].includes(account.accountType)
    ? account.balance.negated()
    : account.balance;

export function reportRange(from?: string, to?: string): ReportRange {
  const today = new Date();
  const firstDay = new Date(Date.UTC(today.getUTCFullYear(), 0, 1));
  const start = parseDate(from) ?? firstDay;
  const end = parseDate(to) ?? today;
  return start <= end ? { from: start, to: end } : { from: end, to: start };
}
export function reportAsOf(value?: string) {
  return parseDate(value) ?? new Date();
}

export async function profitAndLoss(range: ReportRange) {
  const [accounts, mappings] = await Promise.all([postedBalances(range), mappingIds()]);
  const salesRevenue = mappedBalance(accounts, mappings, "SALES_REVENUE").negated();
  const salesDiscounts = mappedBalance(accounts, mappings, "SALES_DISCOUNTS");
  const salesReturns = mappedBalance(accounts, mappings, "SALES_RETURNS");
  const cogs = mappedBalance(accounts, mappings, "COST_OF_GOODS_SOLD");
  const excluded = new Set([
    mappings.get("SALES_DISCOUNTS"),
    mappings.get("SALES_RETURNS"),
    mappings.get("COST_OF_GOODS_SOLD"),
  ]);
  const operatingExpenseRows = accounts
    .filter((account) => account.accountType === "EXPENSE" && !excluded.has(account.id))
    .map((account) => ({ ...account, amount: normal(account).abs() }))
    .filter((account) => !account.amount.isZero());
  const operatingExpenses = sum(operatingExpenseRows.map((account) => account.amount));
  const netSales = salesRevenue.sub(salesDiscounts).sub(salesReturns);
  const grossProfit = netSales.sub(cogs);
  const netProfit = grossProfit.sub(operatingExpenses);
  return {
    accounts,
    operatingExpenseRows: operatingExpenseRows.map((row) => ({
      code: row.code,
      name: row.name,
      amount: format(row.amount),
    })),
    salesRevenue: format(salesRevenue),
    salesDiscounts: format(salesDiscounts),
    salesReturns: format(salesReturns),
    netSales: format(netSales),
    cogs: format(cogs),
    grossProfit: format(grossProfit),
    grossMargin: netSales.isZero() ? null : grossProfit.div(netSales).mul(100).toFixed(4),
    operatingExpenses: format(operatingExpenses),
    netProfit: format(netProfit),
  };
}

export async function balanceSheet(asOf: Date) {
  const [accounts, mappings] = await Promise.all([
    postedBalances({ from: new Date("1970-01-01T00:00:00.000Z"), to: asOf }),
    mappingIds(),
  ]);
  const rowsFor = (type: string) =>
    accounts
      .filter((account) => account.accountType === type)
      .map((account) => ({ ...account, amount: normal(account) }))
      .filter((account) => !account.amount.isZero());
  const assets = sum(rowsFor("ASSET").map((row) => row.amount));
  const liabilities = sum(rowsFor("LIABILITY").map((row) => row.amount));
  const equity = sum(rowsFor("EQUITY").map((row) => row.amount));
  const currentEarnings = new Decimal((await profitAndLoss(yearRange(asOf))).netProfit);
  const presentedEquity = equity.add(currentEarnings);
  return {
    assetRows: serializeRows(rowsFor("ASSET")),
    liabilityRows: serializeRows(rowsFor("LIABILITY")),
    equityRows: serializeRows(rowsFor("EQUITY")),
    inventoryControl: format(
      [
        "RAW_MATERIAL_INVENTORY",
        "PACKAGING_INVENTORY",
        "FINISHED_GOODS_INVENTORY",
        "WORK_IN_PROCESS",
      ]
        .map((key) => mappedBalance(accounts, mappings, key))
        .reduce((total, value) => total.add(value), zero()),
    ),
    assets: format(assets),
    liabilities: format(liabilities),
    equity: format(equity),
    currentEarnings: format(currentEarnings),
    totalLiabilitiesAndEquity: format(liabilities.add(presentedEquity)),
    difference: format(assets.sub(liabilities).sub(presentedEquity)),
  };
}

export async function cashFlow(range: ReportRange) {
  const treasury = await treasuryAccounts();
  const [opening, closing, journals] = await Promise.all([
    accountBalanceAt(
      treasury.map((account) => account.glAccountId),
      before(range.from),
    ),
    accountBalanceAt(
      treasury.map((account) => account.glAccountId),
      range.to,
    ),
    prisma.accountingJournal.findMany({
      where: { status: "POSTED", accountingDate: { gte: range.from, lte: range.to } },
      include: { lines: true },
      orderBy: [{ accountingDate: "asc" }, { journalNumber: "asc" }],
    }),
  ]);
  const treasuryIds = new Set(treasury.map((account) => account.glAccountId));
  const activity = new Map<string, Decimal>();
  for (const journal of journals) {
    const movement = net(journal.lines.filter((line) => treasuryIds.has(line.accountId)));
    if (!movement.isZero()) {
      const category = cashCategory(journal.sourceType);
      activity.set(category, (activity.get(category) ?? zero()).add(movement));
    }
  }
  const operating = activity.get("Operating") ?? zero();
  const investing = activity.get("Investing") ?? zero();
  const financing = activity.get("Financing") ?? zero();
  const other = activity.get("Other") ?? zero();
  const netChange = closing.sub(opening);
  return {
    openingCash: format(opening),
    closingCash: format(closing),
    netChange: format(netChange),
    operating: format(operating),
    investing: format(investing),
    financing: format(financing),
    other: format(other),
    categories: [...activity].map(([name, amount]) => ({ name, amount: format(amount) })),
    reconciliationDifference: format(
      opening.add(operating).add(investing).add(financing).add(other).sub(closing),
    ),
  };
}

export async function receivableAging(asOf: Date) {
  const invoices = await prisma.salesInvoice.findMany({
    where: { status: "POSTED", invoiceDate: { lte: asOf } },
    include: {
      customer: true,
      paymentAllocations: {
        where: { customerPayment: effectiveCustomerPaymentWhere(asOf) },
      },
      salesReturns: {
        where: { status: "COMPLETED", ledgerEntry: { entryDate: { lte: asOf } } },
        include: { ledgerEntry: true },
      },
    },
    orderBy: [{ dueDate: "asc" }, { number: "asc" }],
  });
  const rows = invoices.flatMap((invoice) => {
    const outstanding = customerInvoiceSettlement(invoice).presentationOutstanding;
    return outstanding.gt(0)
      ? [{ invoice, outstanding, bucket: agingBucket(invoice.dueDate, asOf) }]
      : [];
  });
  return agingResult(
    rows.map(({ outstanding, bucket }) => ({ outstanding, bucket })),
    rows.map(({ invoice, outstanding }) => ({
      id: invoice.id,
      number: invoice.number,
      party: invoice.customer.name,
      date: invoice.dueDate,
      outstanding: format(outstanding),
    })),
  );
}

export async function payableAging(asOf: Date) {
  const entries = await prisma.supplierPayableLedgerEntry.findMany({
    where: {
      signedAmount: { gt: 0 },
      sourceType: { not: "SUPPLIER_PAYMENT_REVERSAL" },
      entryDate: { lte: asOf },
    },
    include: {
      supplier: true,
      allocations: { where: { supplierPayment: effectiveSupplierPaymentWhere(asOf) } },
    },
    orderBy: [{ entryDate: "asc" }, { sourceNumber: "asc" }],
  });
  const rows = entries.flatMap((entry) => {
    const allocated = sum(
      entry.allocations.map((allocation) => new Decimal(allocation.allocatedAmount.toString())),
    );
    const outstanding = new Decimal(entry.signedAmount.toString()).sub(allocated);
    return outstanding.gt(0)
      ? [{ entry, outstanding, bucket: agingBucket(entry.entryDate, asOf) }]
      : [];
  });
  return agingResult(
    rows.map(({ outstanding, bucket }) => ({ outstanding, bucket })),
    rows.map(({ entry, outstanding }) => ({
      id: entry.id,
      number: entry.sourceNumber ?? entry.sourceId,
      party: entry.supplier.name,
      date: entry.entryDate,
      outstanding: format(outstanding),
    })),
  );
}

export async function inventoryValuation(asOf: Date) {
  const [entries, accounts, mappings, nonFinalEntryCount] = await Promise.all([
    prisma.inventoryValuationEntry.findMany({
      where: { effectiveAt: { lte: asOf } },
      include: { item: true },
      orderBy: [{ effectiveAt: "asc" }, { createdAt: "asc" }],
    }),
    postedBalances({ from: new Date("1970-01-01T00:00:00.000Z"), to: asOf }),
    mappingIds(),
    prisma.inventoryValuationEntry.count({
      where: { effectiveAt: { lte: asOf }, state: { not: "FINAL" } },
    }),
  ]);
  const latestByItem = new Map(entries.map((entry) => [entry.itemId, entry]));
  const balances = [...latestByItem.values()];
  const byType = new Map<string, Decimal>();
  for (const balance of balances)
    byType.set(
      balance.item.itemType,
      (byType.get(balance.item.itemType) ?? zero()).add(balance.runningInventoryValue.toString()),
    );
  const mappingByType = new Map([
    ["RAW_MATERIAL", "RAW_MATERIAL_INVENTORY"],
    ["PACKAGING_MATERIAL", "PACKAGING_INVENTORY"],
    ["FINISHED_GOOD", "FINISHED_GOODS_INVENTORY"],
  ]);
  const summary = [...byType].map(([type, value]) => {
    const gl = mappedBalance(accounts, mappings, mappingByType.get(type) ?? "");
    return { type, valuation: format(value), gl: format(gl), difference: format(gl.sub(value)) };
  });
  return {
    rows: balances.map((row) => ({
      code: row.item.code,
      name: row.item.name,
      type: row.item.itemType,
      quantity: row.runningOwnedQuantity.toString(),
      value: row.runningInventoryValue.toString(),
      unitCost: row.resultingAverageUnitCost?.toString() ?? null,
      missingBasisCount: row.state === "MISSING_VALUATION_BASIS" ? 1 : 0,
    })),
    summary,
    total: format(sum([...byType.values()])),
    nonFinalEntryCount,
  };
}

export async function productionCosting(asOf: Date) {
  const [snapshots, accounts, mappings] = await Promise.all([
    prisma.productionBatchCostSnapshot.findMany({
      where: { finalizedAt: { lte: asOf } },
      include: { productionBatch: { include: { finishedGood: true } } },
      orderBy: { finalizedAt: "desc" },
      take: 100,
    }),
    postedBalances({ from: new Date("1970-01-01T00:00:00.000Z"), to: asOf }),
    mappingIds(),
  ]);
  return {
    wipGl: format(mappedBalance(accounts, mappings, "WORK_IN_PROCESS")),
    finalizedCostPool: format(
      sum(snapshots.map((row) => new Decimal(row.finishedGoodsCostPool.toString()))),
    ),
    rows: snapshots.map((row) => ({
      batch: row.productionBatch.batchNumber,
      product: row.productionBatch.finishedGood.name,
      status: row.status,
      finalizedAt: row.finalizedAt,
      rawMaterialCost: row.rawMaterialCost.toString(),
      packagingCost: row.packagingCost.toString(),
      additionalCost: row.additionalCost.toString(),
      costCredits: row.costCredits.toString(),
      finishedGoodsCostPool: row.finishedGoodsCostPool.toString(),
      costPerPiece: row.costPerPiece.toString(),
    })),
  };
}

export async function salesProfitability(range: ReportRange) {
  const [invoices, cogsLines] = await Promise.all([
    prisma.salesInvoice.findMany({
      where: { status: "POSTED", invoiceDate: { gte: range.from, lte: range.to } },
      include: { lines: { include: { item: true } } },
    }),
    prisma.accountingJournalLine.findMany({
      where: {
        itemId: { not: null },
        journal: {
          status: "POSTED",
          sourceType: "SALES_INVOICE_COGS",
          accountingDate: { gte: range.from, lte: range.to },
        },
      },
    }),
  ]);
  const rows = new Map<
    string,
    {
      code: string;
      name: string;
      revenue: Decimal;
      discounts: Decimal;
      quantity: Decimal;
      cogs: Decimal;
    }
  >();
  for (const invoice of invoices)
    for (const line of invoice.lines) {
      const row = rows.get(line.itemId) ?? {
        code: line.item.code,
        name: line.item.name,
        revenue: zero(),
        discounts: zero(),
        quantity: zero(),
        cogs: zero(),
      };
      row.revenue = row.revenue.add(line.grossAmount.toString());
      row.discounts = row.discounts.add(line.discountAmount.toString());
      row.quantity = row.quantity.add(line.totalPieces.toString());
      rows.set(line.itemId, row);
    }
  for (const line of cogsLines) {
    const row = rows.get(line.itemId!);
    if (row) row.cogs = row.cogs.add(line.debit.toString()).sub(line.credit.toString());
  }
  return [...rows.values()]
    .map((row) => ({
      code: row.code,
      name: row.name,
      revenue: format(row.revenue),
      discounts: format(row.discounts),
      quantity: format(row.quantity),
      cogs: format(row.cogs),
      grossProfit: format(row.revenue.sub(row.discounts).sub(row.cogs)),
    }))
    .sort((a, b) => a.code.localeCompare(b.code));
}

export async function expenseAndTreasury(range: ReportRange) {
  const [expenses, treasury] = await Promise.all([
    prisma.expenseVoucher.findMany({
      where: { status: "POSTED", expenseDate: { gte: range.from, lte: range.to } },
      include: { lines: { include: { expenseAccount: true } }, treasuryAccount: true },
      orderBy: { expenseDate: "desc" },
    }),
    treasuryAccounts(),
  ]);
  const byAccount = new Map<string, Decimal>();
  for (const expense of expenses)
    for (const line of expense.lines) {
      const name = `${line.expenseAccount.code} — ${line.expenseAccount.name}`;
      byAccount.set(name, (byAccount.get(name) ?? zero()).add(line.amount.toString()));
    }
  return {
    expenses: [...byAccount].map(([name, amount]) => ({ name, amount: format(amount) })),
    treasury: await Promise.all(
      treasury.map(async (account) => ({
        code: account.code,
        name: account.name,
        type: account.accountType,
        balance: format(await accountBalanceAt([account.glAccountId], range.to)),
      })),
    ),
  };
}

export async function financeDashboard(asOf: Date) {
  const range = yearRange(asOf);
  const [pnl, cash, ar, ap, inventory, periods, unresolvedPostingBlocks] = await Promise.all([
    profitAndLoss(range),
    cashFlow(range),
    receivableAging(asOf),
    payableAging(asOf),
    inventoryValuation(asOf),
    prisma.accountingPeriod.findMany({ orderBy: { startDate: "desc" }, take: 6 }),
    prisma.accountingPostingBlock.count({ where: { resolvedAt: null } }),
  ]);
  return { pnl, cash, ar, ap, inventory, periods, unresolvedPostingBlocks };
}

async function postedBalances(range: ReportRange): Promise<BalanceRow[]> {
  const accounts = await prisma.accountingAccount.findMany({
    include: {
      journalLines: {
        where: {
          journal: { status: "POSTED", accountingDate: { gte: range.from, lte: range.to } },
        },
      },
    },
    orderBy: { code: "asc" },
  });
  return accounts.map((account) => ({
    id: account.id,
    code: account.code,
    name: account.name,
    accountType: account.accountType,
    subtype: account.subtype,
    balance: net(account.journalLines),
  }));
}
async function mappingIds() {
  const mappings = await prisma.accountingAccountMapping.findMany({
    where: { accountingSettingsId: "default" },
  });
  return new Map(mappings.map((mapping) => [mapping.mappingKey, mapping.accountId]));
}
function mappedBalance(
  accounts: readonly BalanceRow[],
  mappings: Map<string, string>,
  key: string,
) {
  const accountId = mappings.get(key);
  return accountId
    ? (accounts.find((account) => account.id === accountId)?.balance ?? zero())
    : zero();
}
async function treasuryAccounts() {
  return prisma.treasuryAccount.findMany({
    where: { active: true, accountType: { in: ["CASH", "BANK", "PETTY_CASH"] } },
    orderBy: { code: "asc" },
  });
}
async function accountBalanceAt(accountIds: readonly string[], asOf: Date) {
  if (!accountIds.length) return zero();
  const lines = await prisma.accountingJournalLine.findMany({
    where: {
      accountId: { in: [...accountIds] },
      journal: { status: "POSTED", accountingDate: { lte: asOf } },
    },
  });
  return net(lines);
}
function sum(values: readonly Decimal[]) {
  return values.reduce((total, value) => total.add(value), zero());
}
function serializeRows(rows: readonly (BalanceRow & { amount: Decimal })[]) {
  return rows.map((row) => ({ code: row.code, name: row.name, amount: format(row.amount) }));
}
function parseDate(value?: string) {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? new Date(`${value}T00:00:00.000Z`)
    : undefined;
}
function before(value: Date) {
  const result = new Date(value);
  result.setUTCDate(result.getUTCDate() - 1);
  return result;
}
function yearRange(asOf: Date): ReportRange {
  return { from: new Date(Date.UTC(asOf.getUTCFullYear(), 0, 1)), to: asOf };
}
function agingBucket(dueDate: Date, asOf: Date) {
  const days = Math.floor((asOf.getTime() - dueDate.getTime()) / 86_400_000);
  return days <= 0
    ? "Current"
    : days <= 30
      ? "1–30"
      : days <= 60
        ? "31–60"
        : days <= 90
          ? "61–90"
          : "90+";
}
function agingResult<T>(
  rows: readonly { outstanding: Decimal; bucket: string }[],
  items: readonly T[],
) {
  const buckets = new Map<string, Decimal>([
    ["Current", zero()],
    ["1–30", zero()],
    ["31–60", zero()],
    ["61–90", zero()],
    ["90+", zero()],
  ]);
  for (const row of rows)
    buckets.set(row.bucket, (buckets.get(row.bucket) ?? zero()).add(row.outstanding));
  return {
    buckets: [...buckets].map(([name, amount]) => ({ name, amount: format(amount) })),
    total: format(sum(rows.map((row) => row.outstanding))),
    items,
  };
}
function cashCategory(sourceType: string) {
  return sourceType === "MANUAL_JOURNAL" || sourceType === "MANUAL_REVERSAL"
    ? "Other"
    : sourceType === "CUSTOMER_PAYMENT" ||
        sourceType === "SUPPLIER_PAYMENT" ||
        sourceType === "EXPENSE_VOUCHER" ||
        sourceType === "EXPENSE_REVERSAL" ||
        sourceType === "TREASURY_TRANSFER"
      ? "Operating"
      : "Other";
}
