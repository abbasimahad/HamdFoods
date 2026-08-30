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
        description={`${payment.supplier.name} — ${payment.status}`}
      />
      <Card className="mb-4 p-4 text-sm">
        <p>
          Payment: {payment.totalAmount.toString()} via {payment.treasuryAccount.name}
        </p>
        <p>
          Allocated: {allocated.toFixed(6)}; supplier advance:{" "}
          {new Decimal(payment.totalAmount.toString()).sub(allocated).toFixed(6)}
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
                <td className="p-3">{allocation.allocatedAmount.toString()}</td>
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
