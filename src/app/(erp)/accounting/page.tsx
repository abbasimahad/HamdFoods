import Link from "next/link";
import { AccountingBackfillForm } from "@/components/accounting/accounting-management-forms";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/layout/page-header";
import { ResponsiveContainer } from "@/components/ui/responsive-container";
import { requirePermission } from "@/server/auth/server-guards";
import { hasPermission } from "@/modules/access/domain/principal";
import { accountingDashboard } from "@/server/accounting/prisma-accounting-repository";
import { financeDashboard } from "@/server/accounting/financial-reporting";
export default async function Page() {
  const principal = await requirePermission("accounting.view");
  const [dashboard, finance] = await Promise.all([
    accountingDashboard(),
    financeDashboard(new Date()),
  ]);
  return (
    <ResponsiveContainer>
      <PageHeader
        title="Accounting"
        description="Source-linked double-entry journals derived from operational, valuation, receivable, and production truth."
      />
      <div className="grid gap-4 md:grid-cols-3 xl:grid-cols-5">
        <Card className="p-4">
          <p className="text-sm text-[var(--muted)]">Posted journals</p>
          <p className="text-2xl font-semibold">{dashboard.journals}</p>
        </Card>
        <Card className="p-4">
          <p className="text-sm text-[var(--muted)]">Year-to-date net profit</p>
          <p className="text-2xl font-semibold">{finance.pnl.netProfit}</p>
        </Card>
        <Card className="p-4">
          <p className="text-sm text-[var(--muted)]">Closing cash & bank</p>
          <p className="text-2xl font-semibold">{finance.cash.closingCash}</p>
        </Card>
        <Card className="p-4">
          <p className="text-sm text-[var(--muted)]">Active treasury accounts</p>
          <p className="text-2xl font-semibold">{dashboard.activeTreasuryAccounts}</p>
        </Card>
        <Card className="p-4">
          <p className="text-sm text-[var(--muted)]">Posted expense vouchers</p>
          <p className="text-2xl font-semibold">{dashboard.postedExpenseTotal}</p>
        </Card>
        <Card className="p-4">
          <p className="text-sm text-[var(--muted)]">Inventory carrying value</p>
          <p className="text-2xl font-semibold">{dashboard.inventoryValue}</p>
        </Card>
        <Card className="p-4">
          <p className="text-sm text-[var(--muted)]">Current open period</p>
          <p className="text-lg font-semibold">{dashboard.period?.name ?? "No open period"}</p>
        </Card>
      </div>
      <Card className="mt-5 grid gap-3 p-5 md:grid-cols-3">
        <Link className="font-semibold text-[var(--accent)]" href="/accounting/chart-of-accounts">
          Chart of Accounts
        </Link>
        <Link className="font-semibold text-[var(--accent)]" href="/accounting/journals">
          Journal Browser
        </Link>
        <Link className="font-semibold text-[var(--accent)]" href="/accounting/general-ledger">
          General Ledger
        </Link>
        <Link className="font-semibold text-[var(--accent)]" href="/accounting/trial-balance">
          Trial Balance
        </Link>
        <Link className="font-semibold text-[var(--accent)]" href="/accounting/reconciliation">
          Reconciliation
        </Link>
        <Link className="font-semibold text-[var(--accent)]" href="/accounting/reports">
          Financial Reports
        </Link>
        <Link className="font-semibold text-[var(--accent)]" href="/accounting/cash-bank-accounts">
          Cash &amp; Bank
        </Link>
        <Link className="font-semibold text-[var(--accent)]" href="/accounting/expenses">
          Expense Vouchers
        </Link>
      </Card>
      <Card className="mt-5 grid gap-3 p-5 md:grid-cols-3">
        <div>
          <p className="text-sm text-[var(--muted)]">Accounts receivable</p>
          <p className="text-lg font-semibold">{finance.ar.total}</p>
        </div>
        <div>
          <p className="text-sm text-[var(--muted)]">Accounts payable</p>
          <p className="text-lg font-semibold">{finance.ap.total}</p>
        </div>
        <div>
          <p className="text-sm text-[var(--muted)]">Inventory valuation</p>
          <p className="text-lg font-semibold">{finance.inventory.total}</p>
        </div>
        <p className="text-sm md:col-span-3">
          Unresolved accounting posting blocks: <strong>{finance.unresolvedPostingBlocks}</strong>
        </p>
      </Card>
      {dashboard.blocks.length ? (
        <Card className="mt-5 p-5">
          <h2 className="font-semibold">Blocked accounting events</h2>
          <ul className="mt-2 list-disc pl-5 text-sm">
            {dashboard.blocks.map((block) => (
              <li key={block.id}>
                {block.sourceType}: {block.description}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
      {hasPermission(principal, "accounting.manage") ? (
        <Card className="mt-5 space-y-3 p-5">
          <h2 className="font-semibold">Historical accounting backfill</h2>
          <p className="text-sm text-[var(--muted)]">
            Replays authoritative posted sources through source-idempotent journal rules without
            changing operational documents.
          </p>
          <AccountingBackfillForm />
        </Card>
      ) : null}
    </ResponsiveContainer>
  );
}
