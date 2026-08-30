import Link from "next/link";
import {
  CancelDocumentForm,
  ExpenseVoucherForm,
  PostDocumentForm,
} from "@/components/accounting/phase23-forms";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/layout/page-header";
import { ResponsiveContainer } from "@/components/ui/responsive-container";
import { hasPermission } from "@/modules/access/domain/principal";
import { requirePermission } from "@/server/auth/server-guards";
import {
  expenseVoucherPage,
  treasuryAccounts,
} from "@/server/accounting/prisma-phase23-repository";
import { prisma } from "@/server/db/prisma";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; from?: string; to?: string; page?: string }>;
}) {
  const principal = await requirePermission("accounting.view");
  const query = await searchParams;
  const [treasuries, accounts, expensePage] = await Promise.all([
    treasuryAccounts(),
    prisma.accountingAccount.findMany({
      where: { active: true, postingAllowed: true, isControl: false, accountType: "EXPENSE" },
      orderBy: { code: "asc" },
    }),
    expenseVoucherPage(query),
  ]);
  return (
    <ResponsiveContainer>
      <PageHeader
        title="Expense Vouchers"
        description="Tax-inclusive expenses post through the central GL and paid treasury account."
      />
      {hasPermission(principal, "accounting.manage") ? (
        <Card className="mb-4 p-4">
          <ExpenseVoucherForm
            treasuries={treasuries.filter((account) => account.active)}
            accounts={accounts}
          />
        </Card>
      ) : null}
      <Card className="mb-4 p-4">
        <form className="grid gap-2 md:grid-cols-5">
          <input
            className="rounded border px-3 py-2"
            defaultValue={query.q}
            name="q"
            placeholder="Number, payee, description"
          />
          <select
            className="rounded border px-3 py-2"
            defaultValue={query.status ?? ""}
            name="status"
          >
            <option value="">All statuses</option>
            <option>DRAFT</option>
            <option>POSTED</option>
            <option>CANCELLED</option>
          </select>
          <input
            className="rounded border px-3 py-2"
            defaultValue={query.from}
            name="from"
            type="date"
          />
          <input
            className="rounded border px-3 py-2"
            defaultValue={query.to}
            name="to"
            type="date"
          />
          <button className="rounded border px-3 py-2">Filter</button>
        </form>
      </Card>
      <Card className="overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr>
              <th className="p-3 text-left">Voucher</th>
              <th className="p-3 text-left">Date</th>
              <th className="p-3 text-left">Payee / description</th>
              <th className="p-3 text-left">Accounts</th>
              <th className="p-3 text-left">Treasury</th>
              <th className="p-3 text-left">Total</th>
              <th className="p-3 text-left">Status</th>
              <th className="p-3 text-left">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {expensePage.expenses.map((expense) => (
              <tr key={expense.id}>
                <td className="p-3">
                  <Link
                    className="text-[var(--accent)]"
                    href={`/accounting/expenses/${expense.id}`}
                  >
                    {expense.number}
                  </Link>
                </td>
                <td className="p-3">{expense.expenseDate.toISOString().slice(0, 10)}</td>
                <td className="p-3">{expense.payee ?? expense.description}</td>
                <td className="p-3">
                  {expense.lines.map((line) => line.expenseAccount.code).join(", ")}
                </td>
                <td className="p-3">{expense.treasuryAccount.name}</td>
                <td className="p-3">{expense.totalAmount.toString()}</td>
                <td className="p-3">{expense.status}</td>
                <td className="p-3">
                  {expense.status === "DRAFT" && hasPermission(principal, "accounting.manage") ? (
                    <>
                      <PostDocumentForm id={expense.id} type="expense" />
                      <CancelDocumentForm id={expense.id} type="expense" />
                    </>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      <p className="mt-3 text-sm text-[var(--muted)]">
        Showing page {expensePage.page} of{" "}
        {Math.max(1, Math.ceil(expensePage.total / expensePage.pageSize))} ({expensePage.total}{" "}
        vouchers).
      </p>
    </ResponsiveContainer>
  );
}
