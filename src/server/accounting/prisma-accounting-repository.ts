import "server-only";

import Decimal from "decimal.js";
import { type Prisma } from "@/generated/prisma/client";
import { prisma } from "@/server/db/prisma";
import { outstandingGrni } from "@/modules/purchasing/domain/grni";

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
    ...(query.status === "REVERSED"
      ? { AND: [{ OR: [{ status: "REVERSED" as const }, { reversalJournal: { isNot: null } }] }] }
      : query.status
        ? { status: query.status as "DRAFT" | "POSTED" }
        : {}),
    ...(query.sourceType ? { sourceType: query.sourceType as never } : {}),
    ...(accountingDate ? { accountingDate } : {}),
    ...(query.accountId ? { lines: { some: { accountId: query.accountId } } } : {}),
  };
  const [total, journals, accounts, sourceTypes] = await Promise.all([
    prisma.accountingJournal.count({ where }),
    prisma.accountingJournal.findMany({
      where,
      include: { postedBy: true, reversalJournal: { select: { journalNumber: true } } },
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
  if (!selected) return { accounts, selected: undefined, openingBalance: null, lines: [] };
  const range = dateRange(from, to);
  const lines = await prisma.accountingJournalLine.findMany({
    where: {
      accountId: selected,
      journal: { status: "POSTED", ...(range ? { accountingDate: range } : {}) },
    },
    include: { journal: true },
    // UX-14: by date, then journal number, then line -- never interleaving journals of one day.
    orderBy: [
      { journal: { accountingDate: "asc" } },
      { journal: { journalNumber: "asc" } },
      { position: "asc" },
    ],
  });
  // A "from" date starts from the balance brought forward, so the running balance is the
  // account's real balance rather than restarting at zero.
  const before = range?.gte
    ? await prisma.accountingJournalLine.aggregate({
        where: {
          accountId: selected,
          journal: { status: "POSTED", accountingDate: { lt: range.gte } },
        },
        _sum: { debit: true, credit: true },
      })
    : null;
  const openingBalance = new Decimal(before?._sum.debit?.toString() ?? "0").sub(
    before?._sum.credit?.toString() ?? "0",
  );
  let running = openingBalance;
  return {
    accounts,
    selected,
    openingBalance: before ? openingBalance.toFixed(6) : null,
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
  const [accounts, customer, supplier, valuation, treasuryAccounts, grni] = await Promise.all([
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
    grniReconciliation(),
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
      // Accounts Payable is a liability: its normal balance is a credit, the
      // opposite sign of the debit-net `balance()` helper used for the asset
      // rows above. Negate it so it compares against the payable ledger's
      // own convention of a positive amount owed.
      "Accounts Payable",
      control.get("2000")?.negated(),
      new Decimal(supplier._sum.signedAmount?.toString() ?? "0"),
    ),
    // BUG-35: GRNI (a liability, so negated like AP) against the receipts still awaiting QC and
    // QC-rejected stock not yet returned, each at its receipt cost.
    ...(grni ? [row("Goods Received Not Invoiced (GRNI)", grni.gl, grni.source)] : []),
    row("Raw material inventory", control.get("1200"), inventoryByType.get("RAW_MATERIAL")),
    row("Packaging inventory", control.get("1210"), inventoryByType.get("PACKAGING_MATERIAL")),
    row("Finished goods inventory", control.get("1220"), inventoryByType.get("FINISHED_GOOD")),
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
/**
 * GRNI per the receipts: a received line credits GRNI with its receipt value; QC acceptance moves
 * the accepted share to the payable; a purchase return of QC-rejected stock clears the rest.
 * Replacement receipts count only when they replace QC-rejected (never payable) stock -- other
 * replacements settle a supplier claim instead.
 */
async function grniReconciliation() {
  const settings = await prisma.accountingSettings.findUnique({
    where: { id: "default" },
    include: {
      mappings: {
        where: { mappingKey: "GRNI" },
        include: {
          account: { include: { journalLines: { where: { journal: { status: "POSTED" } } } } },
        },
      },
    },
  });
  const account = settings?.mappings[0]?.account;
  if (!account) return null;
  const [receipts, returned] = await Promise.all([
    prisma.goodsReceipt.findMany({
      where: { status: { in: ["POSTED", "QC_COMPLETED"] } },
      select: {
        status: true,
        purpose: true,
        purchaseReturn: { select: { lines: { select: { source: true } } } },
        lines: {
          select: {
            id: true,
            normalizedQuantity: true,
            qcDecision: { select: { acceptedQuantity: true } },
          },
        },
      },
    }),
    prisma.purchaseReturnLine.groupBy({
      by: ["originalGoodsReceiptLineId"],
      where: {
        source: "QC_REJECTED",
        purchaseReturn: { status: { in: ["POSTED", "AWAITING_REPLACEMENT", "COMPLETED"] } },
      },
      _sum: { normalizedQuantity: true },
    }),
  ]);
  const accrued = receipts.filter((receipt) => {
    if (receipt.purpose === "PURCHASE") return true;
    const replaced = receipt.purchaseReturn?.lines ?? [];
    return replaced.length > 0 && replaced.every((line) => line.source === "QC_REJECTED");
  });
  const lineIds = accrued.flatMap((receipt) => receipt.lines.map((line) => line.id));
  const valuations = lineIds.length
    ? await prisma.inventoryValuationEntry.findMany({
        where: {
          sourceKey: { in: lineIds.map((id) => `GRN-COST:${id}`) },
          entryType: { in: ["PURCHASE_RECEIPT", "SUPPLIER_REPLACEMENT"] },
          state: "FINAL",
        },
        select: { sourceKey: true, valueDelta: true },
      })
    : [];
  const value = new Map(
    valuations.map((entry) => [
      entry.sourceKey.replace("GRN-COST:", ""),
      new Decimal(entry.valueDelta?.toString() ?? "0").abs(),
    ]),
  );
  const returnedByLine = new Map(
    returned.map((group) => [
      group.originalGoodsReceiptLineId,
      group._sum.normalizedQuantity?.toString() ?? "0",
    ]),
  );
  let source = new Decimal(0);
  for (const receipt of accrued)
    for (const line of receipt.lines) {
      const lineValue = value.get(line.id);
      if (!lineValue) continue;
      source = source.add(
        outstandingGrni(
          {
            value: lineValue,
            receivedQuantity: line.normalizedQuantity.toString(),
            acceptedQuantity:
              receipt.status === "QC_COMPLETED"
                ? (line.qcDecision?.acceptedQuantity.toString() ?? "0")
                : null,
          },
          returnedByLine.get(line.id) ?? "0",
        ),
      );
    }
  return { gl: balance(account).net.negated(), source };
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
