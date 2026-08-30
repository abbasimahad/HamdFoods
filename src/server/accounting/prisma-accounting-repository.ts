import "server-only";

import Decimal from "decimal.js";
import { type Prisma } from "@/generated/prisma/client";
import { prisma } from "@/server/db/prisma";

export async function accountingDashboard() {
  const [journals, blocks, period, accounts, valuation, treasuryCount, expenseTotal] =
    await Promise.all([
      prisma.accountingJournal.count({ where: { status: "POSTED" } }),
      prisma.accountingPostingBlock.findMany({
        where: { resolvedAt: null },
        orderBy: { createdAt: "desc" },
        take: 10,
      }),
      prisma.accountingPeriod.findFirst({
        where: { status: "OPEN" },
        orderBy: { startDate: "asc" },
      }),
      prisma.accountingAccount.findMany({
        where: { code: { in: ["1100", "2000", "1230"] } },
        include: { journalLines: { where: { journal: { status: "POSTED" } } } },
      }),
      prisma.inventoryValuationBalance.aggregate({ _sum: { inventoryValue: true } }),
      prisma.treasuryAccount.count({ where: { active: true } }),
      prisma.expenseVoucher.aggregate({
        where: { status: "POSTED" },
        _sum: { totalAmount: true },
      }),
    ]);
  return {
    journals,
    blocks,
    period,
    inventoryValue: valuation._sum.inventoryValue?.toString() ?? "0",
    activeTreasuryAccounts: treasuryCount,
    postedExpenseTotal: expenseTotal._sum.totalAmount?.toString() ?? "0",
    controls: accounts.map(balance),
  };
}

export async function chartOfAccounts() {
  return prisma.accountingAccount.findMany({
    orderBy: [{ code: "asc" }],
    include: { parent: true },
  });
}

export async function journalPage(query: {
  q?: string;
  accountId?: string;
  status?: string;
  sourceType?: string;
  from?: string;
  to?: string;
  page?: string;
}) {
  const pageSize = 50;
  const page = Math.max(1, Number.parseInt(query.page ?? "1", 10) || 1);
  const accountingDate = dateRange(query.from, query.to);
  const where: Prisma.AccountingJournalWhereInput = {
    ...(query.q
      ? {
          OR: [
            { journalNumber: { contains: query.q, mode: "insensitive" as const } },
            { sourceNumber: { contains: query.q, mode: "insensitive" as const } },
          ],
        }
      : {}),
    ...(query.status ? { status: query.status as "DRAFT" | "POSTED" | "REVERSED" } : {}),
    ...(query.sourceType ? { sourceType: query.sourceType as never } : {}),
    ...(accountingDate ? { accountingDate } : {}),
    ...(query.accountId ? { lines: { some: { accountId: query.accountId } } } : {}),
  };
  const [total, journals, accounts, sourceTypes] = await Promise.all([
    prisma.accountingJournal.count({ where }),
    prisma.accountingJournal.findMany({
      where,
      include: { postedBy: true },
      orderBy: [{ accountingDate: "desc" }, { journalNumber: "desc" }],
      take: pageSize,
      skip: (page - 1) * pageSize,
    }),
    prisma.accountingAccount.findMany({ where: { active: true }, orderBy: { code: "asc" } }),
    prisma.accountingJournal.findMany({ distinct: ["sourceType"], select: { sourceType: true } }),
  ]);
  return {
    journals,
    accounts,
    sourceTypes: sourceTypes.map((row) => row.sourceType),
    page,
    pageSize,
    total,
  };
}

export async function generalLedger(accountId?: string, from?: string, to?: string) {
  const accounts = await prisma.accountingAccount.findMany({
    where: { active: true },
    orderBy: { code: "asc" },
  });
  const selected = accountId ?? accounts[0]?.id;
  if (!selected) return { accounts, selected: undefined, lines: [] };
  const range = dateRange(from, to);
  const lines = await prisma.accountingJournalLine.findMany({
    where: {
      accountId: selected,
      journal: { status: "POSTED", ...(range ? { accountingDate: range } : {}) },
    },
    include: { journal: true },
    orderBy: [{ journal: { accountingDate: "asc" } }, { position: "asc" }],
  });
  let running = new Decimal(0);
  return {
    accounts,
    selected,
    lines: lines.map((line) => {
      running = running.add(line.debit).sub(line.credit);
      return { ...line, runningBalance: running.toFixed(6) };
    }),
  };
}

export async function trialBalance(from?: string, to?: string) {
  const range = dateRange(from, to);
  const accounts = await prisma.accountingAccount.findMany({
    include: {
      journalLines: {
        where: { journal: { status: "POSTED", ...(range ? { accountingDate: range } : {}) } },
      },
    },
    orderBy: { code: "asc" },
  });
  const rows = accounts
    .map((account) => ({ account, ...balance(account) }))
    .filter((row) => !row.debit.isZero() || !row.credit.isZero());
  return {
    rows,
    totalDebit: rows.reduce((sum, row) => sum.add(row.debit), new Decimal(0)),
    totalCredit: rows.reduce((sum, row) => sum.add(row.credit), new Decimal(0)),
  };
}

export async function reconciliation() {
  const [accounts, customer, supplier, valuation, treasuryAccounts] = await Promise.all([
    prisma.accountingAccount.findMany({
      where: { code: { in: ["1100", "2000", "1200", "1210", "1220", "1230"] } },
      include: { journalLines: { where: { journal: { status: "POSTED" } } } },
    }),
    prisma.customerLedgerEntry.aggregate({ _sum: { signedAmount: true } }),
    prisma.supplierPayableLedgerEntry.aggregate({ _sum: { signedAmount: true } }),
    prisma.inventoryValuationBalance.findMany({ include: { item: true } }),
    prisma.treasuryAccount.findMany({
      include: {
        glAccount: {
          include: { journalLines: { where: { journal: { status: "POSTED" } } } },
        },
      },
      orderBy: { code: "asc" },
    }),
  ]);
  const control = new Map(accounts.map((account) => [account.code, balance(account).net]));
  const inventoryByType = new Map<string, Decimal>();
  for (const valuationRow of valuation) {
    const type = valuationRow.item.itemType;
    inventoryByType.set(
      type,
      (inventoryByType.get(type) ?? new Decimal(0)).add(valuationRow.inventoryValue.toString()),
    );
  }
  const rows = [
    row(
      "Accounts Receivable",
      control.get("1100"),
      new Decimal(customer._sum.signedAmount?.toString() ?? "0"),
    ),
    row(
      "Accounts Payable",
      control.get("2000"),
      new Decimal(supplier._sum.signedAmount?.toString() ?? "0"),
    ),
    row("Raw material inventory", control.get("1200"), inventoryByType.get("RAW_MATERIAL")),
    row("Packaging inventory", control.get("1210"), inventoryByType.get("PACKAGING_MATERIAL")),
    row("Finished goods inventory", control.get("1220"), inventoryByType.get("FINISHED_GOODS")),
    row("Work in Process", control.get("1230"), undefined),
  ];
  return [
    ...rows,
    ...treasuryAccounts.map((treasury) => {
      const derivedBalance = balance(treasury.glAccount).net;
      return row(`Treasury: ${treasury.code} — ${treasury.name}`, derivedBalance, derivedBalance);
    }),
  ];
}
function dateRange(from?: string, to?: string): Prisma.DateTimeFilter | undefined {
  const start = validDate(from);
  const end = validDate(to, true);
  return start || end
    ? { ...(start ? { gte: start } : {}), ...(end ? { lte: end } : {}) }
    : undefined;
}
function validDate(value?: string, endOfDay = false) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  return new Date(`${value}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}Z`);
}

function balance(account: {
  journalLines: readonly { debit: { toString(): string }; credit: { toString(): string } }[];
}) {
  const debit = account.journalLines.reduce(
    (sum, line) => sum.add(line.debit.toString()),
    new Decimal(0),
  );
  const credit = account.journalLines.reduce(
    (sum, line) => sum.add(line.credit.toString()),
    new Decimal(0),
  );
  return { debit, credit, net: debit.sub(credit) };
}
function row(name: string, gl: Decimal | undefined, source: Decimal | undefined) {
  const g = gl ?? new Decimal(0);
  const s = source ?? new Decimal(0);
  return { name, gl: g, source: s, difference: g.sub(s), comparable: source !== undefined };
}
