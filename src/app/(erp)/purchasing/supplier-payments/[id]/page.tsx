import { formatMoney } from "@/components/ui/format-money";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  CancelDocumentForm,
  DocumentReversalForm,
  PostDocumentForm,
  SupplierPaymentAllocationForm,
} from "@/components/accounting/phase23-forms";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/layout/page-header";
import { ResponsiveContainer } from "@/components/ui/responsive-container";
import { hasPermission } from "@/modules/access/domain/principal";
import { requirePermission } from "@/server/auth/server-guards";
import { oldestFirstAllocationProposal } from "@/server/accounting/prisma-phase23-repository";
import { prisma } from "@/server/db/prisma";
import Decimal from "decimal.js";
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const principal = await requirePermission("accounting.view");
  const payment = await prisma.supplierPayment.findUnique({
    where: { id: (await params).id },
    include: {
      supplier: true,
      treasuryAccount: true,
      allocations: { include: { payableLedgerEntry: true } },
      postedBy: true,
      reversalOf: true,
      reversalPayment: true,
    },
  });
  if (!payment) notFound();
  const [allocated, proposal] = await Promise.all([
    Promise.resolve(
      payment.allocations.reduce((total, item) => total.add(item.allocatedAmount), new Decimal(0)),
    ),
    oldestFirstAllocationProposal(payment.id),
  ]);
  return (
    <ResponsiveContainer>
      <PageHeader
        title={payment.number}
        description={
          payment.reversalOf
            ? `${payment.supplier.name} — reversal of payment ${payment.reversalOf.number}; cancels its payable and cash effect.`
            : payment.reversalPayment
              ? `${payment.supplier.name} — payment REVERSED by ${payment.reversalPayment.number}; it no longer reduces the payable or uses cash.`
              : `${payment.supplier.name} — ${payment.status}`
        }
      />
      {/* BUG-36: mirror customer receipts -- a reversed payment must not look valid. */}
      {payment.reversalPayment && (
        <p className="mb-4 rounded border-2 border-red-700 bg-red-50 p-3 font-semibold text-red-700">
          This payment has been REVERSED by {payment.reversalPayment.number}. Its payable and
          treasury effects are no longer in force.
        </p>
      )}
      <p className="mb-4">
        <Link
          className="rounded-lg border px-4 py-2 text-sm font-semibold"
          href={`/purchasing/supplier-payments/${payment.id}/print`}
        >
          Print
        </Link>
      </p>
      <Card className="mb-4 p-4 text-sm">
        <p>
          Payment: {formatMoney(payment.totalAmount, "")} via {payment.treasuryAccount.name}
        </p>
        <p>
          Status:{" "}
          {payment.reversalPayment ? (
            <span className="font-semibold text-red-700">POSTED (REVERSED)</span>
          ) : payment.reversalOf ? (
            <span className="font-semibold text-red-700">POSTED (REVERSAL)</span>
          ) : (
            payment.status
          )}
        </p>
        <p>
          Allocated: {formatMoney(allocated, "")}; supplier advance:{" "}
          {formatMoney(
            payment.status === "POSTED" && !payment.reversalOf && !payment.reversalPayment
              ? new Decimal(payment.totalAmount.toString()).sub(allocated)
              : 0,
            "",
          )}
        </p>
        <p>Reference: {payment.referenceNumber ?? "—"}</p>
        {payment.reversalOf ? <p>Reversal of: {payment.reversalOf.number}</p> : null}
        {payment.reversalPayment ? <p>Reversed by: {payment.reversalPayment.number}</p> : null}
        {payment.status === "DRAFT" && hasPermission(principal, "accounting.manage") ? (
          <div className="mt-3">
            <PostDocumentForm id={payment.id} type="payment" />
            <CancelDocumentForm id={payment.id} type="payment" />
          </div>
        ) : null}
      </Card>
      <Card className="mb-4 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr>
              <th className="p-3 text-left">Allocated payable</th>
              <th className="p-3 text-left">Amount</th>
            </tr>
          </thead>
          <tbody>
            {payment.allocations.map((allocation) => (
              <tr key={allocation.id}>
                <td className="p-3">
                  {allocation.payableLedgerEntry.sourceNumber ??
                    allocation.payableLedgerEntry.sourceId}
                </td>
                <td className="p-3">{formatMoney(allocation.allocatedAmount, "")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      {payment.status === "POSTED" && hasPermission(principal, "accounting.manage") ? (
        <Card className="space-y-4 p-4">
          {payment.reversalOf || payment.reversalPayment ? (
            <p className="text-sm">This payment is part of a linked reversal.</p>
          ) : (
            <>
              <DocumentReversalForm id={payment.id} type="payment" />
              <div>
                <h2 className="mb-2 font-semibold">Allocate remaining supplier advance</h2>
                <SupplierPaymentAllocationForm paymentId={payment.id} proposal={proposal} />
              </div>
            </>
          )}
        </Card>
      ) : null}
    </ResponsiveContainer>
  );
}
