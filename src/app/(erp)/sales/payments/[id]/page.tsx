import Link from "next/link";
import { notFound } from "next/navigation";
import { CustomerCreditAllocationForm } from "@/components/sales/customer-credit-allocation-form";
import { PageHeader } from "@/components/layout/page-header";
import { Card } from "@/components/ui/card";
import { ResponsiveContainer } from "@/components/ui/responsive-container";
import { hasPermission } from "@/modules/access/domain/principal";
import { requirePermission } from "@/server/auth/server-guards";
import { PrismaCustomerPaymentRepository } from "@/server/sales/prisma-customer-payment-repository";
import {
  allocateCustomerCreditAction,
  cancelCustomerPaymentFormAction,
  postCustomerPaymentFormAction,
} from "../actions";
export default async function CustomerPaymentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const principal = await requirePermission("sales.view");
  const repository = new PrismaCustomerPaymentRepository();
  const payment = await repository.getCustomerPayment((await params).id);
  if (!payment) notFound();
  const canManage = hasPermission(principal, "sales.manage");
  const openInvoices =
    canManage && payment.status === "POSTED" && Number(payment.unallocatedAmount) > 0
      ? await repository.getOpenInvoices(payment.customerId)
      : [];
  return (
    <ResponsiveContainer>
      <PageHeader
        title={payment.number}
        description={`Customer payment ${payment.status}; it has no inventory, sales-revenue, or General Ledger effect.`}
      />
      <p className="mb-4 flex gap-3">
        <Link className="rounded border px-4 py-2" href={`/sales/payments/${payment.id}/print`}>
          Print receipt
        </Link>
        {canManage && payment.status === "DRAFT" && (
          <Link className="rounded border px-4 py-2" href={`/sales/payments/${payment.id}/edit`}>
            Edit draft
          </Link>
        )}
      </p>
      <Card className="mb-4 grid gap-3 p-5 md:grid-cols-2">
        <p>
          Customer: {payment.customerCode} — {payment.customerName}
        </p>
        <p>Date: {payment.paymentDate.toLocaleDateString()}</p>
        <p>Method: {payment.method}</p>
        <p>Amount: {payment.totalAmount}</p>
        <p>Reference: {payment.referenceNumber ?? "-"}</p>
        <p>
          Bank / cheque:{" "}
          {[payment.bankName, payment.chequeNumber, payment.chequeDate?.toLocaleDateString()]
            .filter(Boolean)
            .join(" / ") || "-"}
        </p>
        <p>Allocated: {payment.allocatedAmount}</p>
        <p>Unallocated customer credit: {payment.unallocatedAmount}</p>
        <p>Created by: {payment.createdByName}</p>
        <p>
          Posted:{" "}
          {payment.postedByName
            ? `${payment.postedByName} on ${payment.postedAt?.toLocaleString()}`
            : "Not posted"}
        </p>
      </Card>
      <Card className="overflow-x-auto">
        <h2 className="p-4 font-semibold">Allocations</h2>
        <table className="w-full min-w-[55rem] text-left text-sm">
          <thead className="bg-[var(--surface)]">
            <tr>
              <th className="p-3">Invoice</th>
              <th className="p-3">Invoice date</th>
              <th className="p-3">Original</th>
              <th className="p-3">Allocated</th>
              <th className="p-3">Remaining outstanding</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {payment.allocations.map((allocation) => (
              <tr key={`${allocation.id}-${allocation.allocatedAmount}`}>
                <td className="p-3">
                  <Link className="text-[var(--accent)]" href={`/sales/invoices/${allocation.id}`}>
                    {allocation.number}
                  </Link>
                </td>
                <td className="p-3">{allocation.invoiceDate.toLocaleDateString()}</td>
                <td className="p-3">{allocation.originalAmount}</td>
                <td className="p-3">{allocation.allocatedAmount}</td>
                <td className="p-3">{allocation.outstandingAmount}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!payment.allocations.length && (
          <p className="p-4 text-sm text-[var(--muted)]">
            No invoice allocation; the full amount remains customer credit when posted.
          </p>
        )}
      </Card>
      {canManage && payment.status === "POSTED" && Number(payment.unallocatedAmount) > 0 && (
        <Card className="mt-4 p-5">
          <CustomerCreditAllocationForm
            action={allocateCustomerCreditAction}
            availableCredit={payment.unallocatedAmount}
            customerId={payment.customerId}
            invoices={openInvoices}
            paymentId={payment.id}
          />
        </Card>
      )}
      {canManage && payment.status === "DRAFT" && (
        <Card className="mt-4 flex gap-3 p-5">
          <form action={postCustomerPaymentFormAction}>
            <input name="id" type="hidden" value={payment.id} />
            <input name="customerId" type="hidden" value={payment.customerId} />
            <button className="rounded bg-[var(--accent)] px-4 py-2 text-white">
              Post payment
            </button>
          </form>
          <form action={cancelCustomerPaymentFormAction}>
            <input name="id" type="hidden" value={payment.id} />
            <input name="customerId" type="hidden" value={payment.customerId} />
            <input name="reason" placeholder="Reason" required />
            <button className="ml-2 rounded border px-4 py-2">Cancel draft</button>
          </form>
        </Card>
      )}
    </ResponsiveContainer>
  );
}
