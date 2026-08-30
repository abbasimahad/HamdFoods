import Link from "next/link";
import { notFound } from "next/navigation";
import {
  CancelDocumentForm,
  ExpenseReversalForm,
  PostDocumentForm,
} from "@/components/accounting/phase23-forms";
import { Card } from "@/components/ui/card";
import { AuditTimeline } from "@/components/audit/audit-timeline";
import { PageHeader } from "@/components/layout/page-header";
import { ResponsiveContainer } from "@/components/ui/responsive-container";
import { hasPermission } from "@/modules/access/domain/principal";
import { requirePermission } from "@/server/auth/server-guards";
import { prisma } from "@/server/db/prisma";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const principal = await requirePermission("accounting.view");
  const expense = await prisma.expenseVoucher.findUnique({
    where: { id: (await params).id },
    include: {
      treasuryAccount: true,
      supplier: true,
      lines: { include: { expenseAccount: true }, orderBy: { position: "asc" } },
      reversalOf: true,
      reversalVoucher: true,
    },
  });
  if (!expense) notFound();
  const canManage = hasPermission(principal, "accounting.manage");
  return (
    <ResponsiveContainer>
      <PageHeader
        title={expense.number}
        description={`${expense.status} expense voucher — tax-inclusive amounts.`}
      />
      <Card className="mb-4 p-4 text-sm">
        <p>Date: {expense.expenseDate.toISOString().slice(0, 10)}</p>
        <p>Paid from: {expense.treasuryAccount.name}</p>
        <p>Payee: {expense.payee ?? expense.supplier?.name ?? "—"}</p>
        <p>Description: {expense.description}</p>
        <p>Total: {expense.totalAmount.toString()}</p>
        <p>Reference: {expense.referenceNumber ?? "—"}</p>
        <p>
          <Link className="text-[var(--accent)]" href={`/accounting/expenses/${expense.id}/print`}>
            Print-friendly voucher
          </Link>
        </p>
        {expense.reversalOf ? <p>Reversal of: {expense.reversalOf.number}</p> : null}
        {expense.reversalVoucher ? <p>Reversed by: {expense.reversalVoucher.number}</p> : null}
        {canManage && expense.status === "DRAFT" ? (
          <div className="mt-3">
            <PostDocumentForm id={expense.id} type="expense" />
            <CancelDocumentForm id={expense.id} type="expense" />
          </div>
        ) : null}
        {canManage &&
        expense.status === "POSTED" &&
        !expense.reversalVoucher &&
        !expense.reversalOf ? (
          <ExpenseReversalForm id={expense.id} />
        ) : null}
      </Card>
      <Card className="overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr>
              <th className="p-3 text-left">Account</th>
              <th className="p-3 text-left">Description</th>
              <th className="p-3 text-left">Tax-inclusive amount</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {expense.lines.map((line) => (
              <tr key={line.id}>
                <td className="p-3">
                  {line.expenseAccount.code} — {line.expenseAccount.name}
                </td>
                <td className="p-3">{line.description}</td>
                <td className="p-3">{line.amount.toString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      <AuditTimeline entityType="EXPENSE_VOUCHER" entityId={expense.id} />
    </ResponsiveContainer>
  );
}
