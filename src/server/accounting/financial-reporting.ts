import "server-only";

import Decimal from "decimal.js";
import {
  effectiveCustomerPaymentWhere,
  effectiveSupplierPaymentWhere,
} from "@/server/accounting/payment-effectiveness";
import { customerInvoiceSettlement } from "@/server/sales/customer-invoice-settlement";
import { prisma } from "@/server/db/prisma";
import { endOfFactoryLocalDay } from "@/server/shared/factory-local-time";

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
  const todayEnd = endOfFactoryLocalDay();
  const firstDay = new Date(Date.UTC(todayEnd.getUTCFullYear(), 0, 1));
  const start = parseDate(from) ?? firstDay;
  // An inclusive "to"/"as of" date covers the whole factory-local day, so timestamped rows
  // (valuation entries, completions) posted after 05:00 PKT on that date are not cut off.
  const end = parseDate(to) ? endOfFactoryLocalDay(to) : todayEnd;
  return start <= end ? { from: start, to: end } : { from: end, to: start };
}
export function reportAsOf(value?: string) {
  return parseDate(value) ? endOfFactoryLocalDay(value) : endOfFactoryLocalDay();
}

export async function profitAndLoss(range: ReportRange) {
  const [accounts, mappings] = await Promise.all([postedBalances(range), mappingIds()]);
  const salesRevenue = mappedBalance(accounts, mappings, "SALES_REVENUE").negated();
  const salesDiscounts = mappedBalance(accounts, mappings, "SALES_DISCOUNTS");
  const salesReturns = mappedBalance(accounts, mappings, "SALES_RETURNS");
  const cogs = mappedBalance(accounts, mappings, "COST_OF_GOODS_SOLD");
  const excluded = new Set([
    mappings.get("SALES_REVENUE"),
    mappings.get("SALES_DISCOUNTS"),
    mappings.get("SALES_RETURNS"),
    mappings.get("COST_OF_GOODS_SOLD"),
  ]);
  // Signed, never abs(): a credit-balance expense account (for example a favourable purchase
  // return variance) reduces expenses. Every other revenue account is other income. So net profit
  // is exactly the net of all revenue and expense accounts, which the balance sheet relies on.
  const operatingExpenseRows = accounts
    .filter((account) => account.accountType === "EXPENSE" && !excluded.has(account.id))
    .map((account) => ({ ...account, amount: account.balance }))
    .filter((account) => !account.amount.isZero());
  const otherIncomeRows = accounts
    .filter((account) => account.accountType === "REVENUE" && !excluded.has(account.id))
    .map((account) => ({ ...account, amount: account.balance.negated() }))
    .filter((account) => !account.amount.isZero());
  const operatingExpenses = sum(operatingExpenseRows.map((account) => account.amount));
  const otherIncome = sum(otherIncomeRows.map((account) => account.amount));
  const netSales = salesRevenue.sub(salesDiscounts).sub(salesReturns);
  const grossProfit = netSales.sub(cogs);
  const netProfit = grossProfit.add(otherIncome).sub(operatingExpenses);
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
    otherIncomeRows: otherIncomeRows.map((row) => ({
      code: row.code,
      name: row.name,
      amount: format(row.amount),
    })),
    otherIncome: format(otherIncome),
    operatingExpenses: format(operatingExpenses),
    netProfit: format(netProfit),
  };
}

export async function balanceSheet(asOf: Date) {
  const [accounts, mappings, advances] = await Promise.all([
    postedBalances({ from: new Date("1970-01-01T00:00:00.000Z"), to: asOf }),
    mappingIds(),
    counterpartyAdvances(asOf),
  ]);
  // UX-15: a customer who has paid in advance is owed goods, not owing money. Receivables show
  // only what customers owe, and credit balances appear as a "Customer advances" liability
  // (likewise supplier debit balances as a "Supplier advances" asset). Both sides grow by the
  // same amount, so totals and the balance check are unchanged.
  const grossUp = new Map<string, Decimal>([
    [mappings.get("ACCOUNTS_RECEIVABLE") ?? "", advances.customer],
    [mappings.get("ACCOUNTS_PAYABLE") ?? "", advances.supplier],
  ]);
  const rowsFor = (type: string) =>
    accounts
      .filter((account) => account.accountType === type)
      .map((account) => ({
        ...account,
        amount: normal(account).add(grossUp.get(account.id) ?? zero()),
      }))
      .filter((account) => !account.amount.isZero());
  const advanceRow = (
    key: "ACCOUNTS_RECEIVABLE" | "ACCOUNTS_PAYABLE",
    name: string,
    accountType: string,
    amount: Decimal,
  ): (BalanceRow & { amount: Decimal })[] => {
    const account = accounts.find((row) => row.id === mappings.get(key));
    return account && amount.gt(0)
      ? [{ ...account, name, accountType, balance: amount, amount }]
      : [];
  };
  const assetRows = [
    ...rowsFor("ASSET"),
    ...advanceRow("ACCOUNTS_PAYABLE", "Supplier advances", "ASSET", advances.supplier),
  ];
  const liabilityRows = [
    ...rowsFor("LIABILITY"),
    ...advanceRow("ACCOUNTS_RECEIVABLE", "Customer advances", "LIABILITY", advances.customer),
  ];
  const assets = sum(assetRows.map((row) => row.amount));
  const liabilities = sum(liabilityRows.map((row) => row.amount));
  const equity = sum(rowsFor("EQUITY").map((row) => row.amount));
  const yearToDate = yearRange(asOf);
  const [current, prior] = await Promise.all([
    profitAndLoss(yearToDate),
    profitAndLoss({
      from: new Date("1970-01-01T00:00:00.000Z"),
      to: new Date(yearToDate.from.getTime() - 1),
    }),
  ]);
  const currentEarnings = new Decimal(current.netProfit);
  // No year-end closing journal moves profit to equity, so earlier years' profit is presented
  // as retained earnings; without it the balance sheet stops balancing every 1 January.
  const priorEarnings = new Decimal(prior.netProfit);
  const presentedEquity = equity.add(priorEarnings).add(currentEarnings);
  return {
    assetRows: serializeRows(assetRows),
    liabilityRows: serializeRows(liabilityRows),
    customerAdvances: format(advances.customer),
    supplierAdvances: format(advances.supplier),
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
    priorEarnings: priorEarnings.isZero() ? null : format(priorEarnings),
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
  // The authoritative per-item balance (the same figure Inventory > Valuation and the GL
  // reconciliation use) minus every valuation entry that takes effect after the as-of date. This
  // does not depend on the order of `effectiveAt` timestamps: picking the "latest" entry by
  // effectiveAt returned a stale running balance whenever an entry was stamped earlier than
  // movements posted before it (BUG-30, waste write-offs stamped at 00:00 UTC).
  const [items, later, accounts, mappings, nonFinalEntryCount] = await Promise.all([
    prisma.item.findMany({
      where: { inventoryValuationBalance: { isNot: null } },
      include: { inventoryValuationBalance: true },
      orderBy: [{ itemType: "asc" }, { code: "asc" }],
    }),
    prisma.inventoryValuationEntry.groupBy({
      by: ["itemId"],
      where: { effectiveAt: { gt: asOf } },
      _sum: { quantityEffect: true, valueDelta: true },
    }),
    postedBalances({ from: new Date("1970-01-01T00:00:00.000Z"), to: asOf }),
    mappingIds(),
    prisma.inventoryValuationEntry.count({
      where: { effectiveAt: { lte: asOf }, state: { not: "FINAL" } },
    }),
  ]);
  const laterByItem = new Map(later.map((row) => [row.itemId, row._sum]));
  const balances = items.flatMap((item) => {
    const balance = item.inventoryValuationBalance!;
    const after = laterByItem.get(item.id);
    const quantity = new Decimal(balance.ownedQuantity.toString()).sub(
      after?.quantityEffect?.toString() ?? "0",
    );
    const value = new Decimal(balance.inventoryValue.toString()).sub(
      after?.valueDelta?.toString() ?? "0",
    );
    if (quantity.isZero() && value.isZero()) return [];
    return [{ item, quantity, value, missingBasisCount: balance.missingBasisCount }];
  });
  const byType = new Map<string, Decimal>();
  for (const balance of balances)
    byType.set(
      balance.item.itemType,
      (byType.get(balance.item.itemType) ?? zero()).add(balance.value),
    );
  const mappingByType = new Map([
    ["RAW_MATERIAL", "RAW_MATERIAL_INVENTORY"],
    ["PACKAGING_MATERIAL", "PACKAGING_INVENTORY"],
    ["FINISHED_GOOD", "FINISHED_GOODS_INVENTORY"],
  ]);
  const summary = [...mappingByType].flatMap(([type, mapping]) => {
    const value = byType.get(type) ?? zero();
    const gl = mappedBalance(accounts, mappings, mapping);
    if (!byType.has(type) && gl.isZero()) return [];
    return [{ type, valuation: format(value), gl: format(gl), difference: format(gl.sub(value)) }];
  });
  return {
    rows: balances.map((row) => ({
      code: row.item.code,
      name: row.item.name,
      type: row.item.itemType,
      quantity: row.quantity.toFixed(),
      value: row.value.toFixed(6),
      unitCost:
        row.missingBasisCount === 0 && row.quantity.gt(0)
          ? row.value.div(row.quantity).toDecimalPlaces(6, Decimal.ROUND_HALF_UP).toFixed(6)
          : null,
      missingBasisCount: row.missingBasisCount,
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
  const mappings = await mappingIds();
  const costOfGoodsSoldAccountId = mappings.get("COST_OF_GOODS_SOLD");
  const [invoices, cogsLines] = await Promise.all([
    prisma.salesInvoice.findMany({
      where: { status: "POSTED", invoiceDate: { gte: range.from, lte: range.to } },
      include: { lines: { include: { item: true } } },
    }),
    // Each COGS journal also carries a matching finished-goods-inventory
    // credit line per item; both sides carry the same itemId, so scoping to
    // the COST_OF_GOODS_SOLD account itself (not just "has an itemId") keeps
    // the debit and credit from canceling each other out to zero.
    costOfGoodsSoldAccountId
      ? prisma.accountingJournalLine.findMany({
          where: {
            itemId: { not: null },
            accountId: costOfGoodsSoldAccountId,
            journal: {
              status: "POSTED",
              sourceType: "SALES_INVOICE_COGS",
              accountingDate: { gte: range.from, lte: range.to },
            },
          },
        })
      : Promise.resolve([]),
  ]);
  const rows = new Map<
    string,
    {
      code: string;
      name: string;
      revenue: Decimal;
      discounts: Decimal;
      returns: Decimal;
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
        returns: zero(),
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
  // Invoiced sales returns completed in the period reduce revenue (credit value excluding tax),
  // quantity, and COGS (the cost restored to finished goods), per product.
  const salesReturns = await prisma.salesReturn.findMany({
    where: {
      status: "COMPLETED",
      type: "INVOICED_RETURN",
      completedAt: { gte: range.from, lte: range.to },
    },
    include: { lines: { include: { item: true } } },
  });
  const restoredCost = salesReturns.length
    ? await prisma.inventoryValuationEntry.groupBy({
        by: ["itemId"],
        where: {
          entryType: "SALES_RETURN",
          state: "FINAL",
          sourceType: "SALES_RETURN",
          sourceId: { in: salesReturns.map((salesReturn) => salesReturn.id) },
        },
        _sum: { valueDelta: true },
      })
    : [];
  for (const salesReturn of salesReturns)
    for (const line of salesReturn.lines) {
      const row = rows.get(line.itemId) ?? {
        code: line.item.code,
        name: line.item.name,
        revenue: zero(),
        discounts: zero(),
        returns: zero(),
        quantity: zero(),
        cogs: zero(),
      };
      row.returns = row.returns.add(
        new Decimal(line.netAmount?.toString() ?? "0").sub(line.taxAmount?.toString() ?? "0"),
      );
      row.quantity = row.quantity.sub(line.totalPieces.toString());
      rows.set(line.itemId, row);
    }
  for (const entry of restoredCost) {
    const row = rows.get(entry.itemId);
    if (row) row.cogs = row.cogs.sub(entry._sum.valueDelta?.toString() ?? "0");
  }
  return [...rows.values()]
    .map((row) => ({
      code: row.code,
      name: row.name,
      revenue: format(row.revenue),
      discounts: format(row.discounts),
      returns: format(row.returns),
      quantity: row.quantity.toFixed(),
      cogs: format(row.cogs),
      grossProfit: format(row.revenue.sub(row.discounts).sub(row.returns).sub(row.cogs)),
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
/**
 * Credit balances of individual customers (paid ahead of invoices) and debit balances of
 * individual suppliers (paid ahead of bills), from the authoritative subledgers.
 */
export async function counterpartyAdvances(asOf?: Date) {
  const [customers, suppliers] = await Promise.all([
    prisma.customerLedgerEntry.groupBy({
      by: ["customerId"],
      where: asOf ? { entryDate: { lte: asOf } } : {},
      _sum: { signedAmount: true },
    }),
    prisma.supplierPayableLedgerEntry.groupBy({
      by: ["supplierId"],
      where: asOf ? { entryDate: { lte: asOf } } : {},
      _sum: { signedAmount: true },
    }),
  ]);
  const creditBalances = (rows: readonly { _sum: { signedAmount: unknown } }[]) =>
    sum(
      rows
        .map((row) => new Decimal(String(row._sum.signedAmount ?? "0")))
        .filter((balance) => balance.lt(0))
        .map((balance) => balance.abs()),
    );
  return { customer: creditBalances(customers), supplier: creditBalances(suppliers) };
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
// A reversal (bounced cheque, voided payment, reversed expense) is classified with the document it
// reverses, so the original and its reversal net to zero inside the same cash-flow section.
const OPERATING_CASH_SOURCE_TYPES = new Set([
  "CUSTOMER_PAYMENT",
  "CUSTOMER_PAYMENT_REVERSAL",
  "SUPPLIER_PAYMENT",
  "SUPPLIER_PAYMENT_REVERSAL",
  "EXPENSE_VOUCHER",
  "EXPENSE_REVERSAL",
  "TREASURY_TRANSFER",
]);

export function cashCategory(sourceType: string) {
  return OPERATING_CASH_SOURCE_TYPES.has(sourceType) ? "Operating" : "Other";
}

/**
 * Sales-tax (output/input) summary and invoice register for a period. The summary comes from the
 * posted GL (the OUTPUT_TAX and INPUT_TAX mapped accounts), so it always agrees with the trial
 * balance; the register lists each posted invoice with the buyer's registration number.
 */
export async function salesTaxReport(range: ReportRange) {
  const mappings = await mappingIds();
  const outputTaxAccountId = mappings.get("OUTPUT_TAX");
  const inputTaxAccountId = mappings.get("INPUT_TAX");
  const [invoices, outputLines, inputLines] = await Promise.all([
    prisma.salesInvoice.findMany({
      where: { status: "POSTED", invoiceDate: { gte: range.from, lte: range.to } },
      include: { customer: true },
      orderBy: [{ invoiceDate: "asc" }, { number: "asc" }],
    }),
    outputTaxAccountId
      ? prisma.accountingJournalLine.findMany({
          where: {
            accountId: outputTaxAccountId,
            journal: { status: "POSTED", accountingDate: { gte: range.from, lte: range.to } },
          },
          include: { journal: { select: { sourceType: true } } },
        })
      : Promise.resolve([]),
    inputTaxAccountId
      ? prisma.accountingJournalLine.findMany({
          where: {
            accountId: inputTaxAccountId,
            journal: { status: "POSTED", accountingDate: { gte: range.from, lte: range.to } },
          },
        })
      : Promise.resolve([]),
  ]);
  let outputOnSales = zero();
  let outputReversed = zero();
  for (const line of outputLines) {
    const credit = new Decimal(line.credit.toString());
    const debit = new Decimal(line.debit.toString());
    outputOnSales = outputOnSales.add(credit);
    outputReversed = outputReversed.add(debit);
  }
  const netOutput = outputOnSales.sub(outputReversed);
  const inputTax = inputLines.reduce(
    (total, line) => total.add(line.debit.toString()).sub(line.credit.toString()),
    zero(),
  );
  const register = invoices.map((invoice) => {
    const valueExclTax = new Decimal(invoice.subtotal.toString()).sub(
      invoice.discountTotal.toString(),
    );
    return {
      id: invoice.id,
      number: invoice.number,
      invoiceDate: invoice.invoiceDate,
      customerName: invoice.customer.name,
      customerTaxRegistrationNo: invoice.customer.taxRegistrationNo,
      valueExclTax: format(valueExclTax),
      taxTotal: format(new Decimal(invoice.taxTotal.toString())),
      grandTotal: format(new Decimal(invoice.grandTotal.toString())),
    };
  });
  const registered = invoices.filter((invoice) => invoice.customer.taxRegistrationNo);
  return {
    register,
    totals: {
      invoiceCount: invoices.length,
      registeredBuyerCount: new Set(registered.map((invoice) => invoice.customerId)).size,
      valueExclTax: format(
        invoices.reduce(
          (total, invoice) =>
            total.add(invoice.subtotal.toString()).sub(invoice.discountTotal.toString()),
          zero(),
        ),
      ),
      outputOnSales: format(outputOnSales),
      outputReversed: format(outputReversed),
      netOutput: format(netOutput),
      inputTax: format(inputTax),
      netPayable: format(netOutput.sub(inputTax)),
    },
  };
}
