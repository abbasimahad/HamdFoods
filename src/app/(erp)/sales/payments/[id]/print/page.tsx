import { notFound } from "next/navigation";
import { requirePermission } from "@/server/auth/server-guards";
import { PrismaCustomerPaymentRepository } from "@/server/sales/prisma-customer-payment-repository";
export default async function CustomerPaymentPrintPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requirePermission("sales.view");
  const payment = await new PrismaCustomerPaymentRepository().getCustomerPayment((await params).id);
  if (!payment) notFound();
  return (
    <main className="mx-auto max-w-4xl bg-white p-8 text-black print:p-0">
      <header className="mb-6 flex justify-between border-b pb-4">
        <div>
          <h1 className="text-2xl font-bold">Customer Receipt</h1>
          <p>{payment.number}</p>
        </div>
        <div className="text-right">
          <p>{payment.paymentDate.toLocaleDateString()}</p>
          <p>{payment.status}</p>
        </div>
      </header>
      <section className="mb-6 grid grid-cols-2 gap-4 text-sm">
        <div>
          <strong>Customer</strong>
          <p>
            {payment.customerCode} — {payment.customerName}
          </p>
        </div>
        <div>
          <strong>Payment</strong>
          <p>
            {payment.method} · {payment.totalAmount}
          </p>
          <p>Reference: {payment.referenceNumber ?? "-"}</p>
        </div>
      </section>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-y">
            <th>Invoice</th>
            <th>Original</th>
            <th>Allocated</th>
            <th>Outstanding</th>
          </tr>
        </thead>
        <tbody>
          {payment.allocations.map((allocation) => (
            <tr className="border-b" key={`${allocation.id}-${allocation.allocatedAmount}`}>
              <td>{allocation.number}</td>
              <td>{allocation.originalAmount}</td>
              <td>{allocation.allocatedAmount}</td>
              <td>{allocation.outstandingAmount}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-5 text-right">
        Allocated {payment.allocatedAmount} · Unallocated credit {payment.unallocatedAmount}
      </p>
      {payment.notes && <p className="mt-6 text-sm">{payment.notes}</p>}
      <p className="mt-8 text-sm">Posted / authorized by: {payment.postedByName ?? "Draft"}</p>
    </main>
  );
}
