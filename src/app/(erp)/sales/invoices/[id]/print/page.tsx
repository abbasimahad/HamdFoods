import { notFound } from "next/navigation";
import { requirePermission } from "@/server/auth/server-guards";
import { PrismaSalesInvoiceRepository } from "@/server/sales/prisma-sales-invoice-repository";
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission("sales.view");
  const x = await new PrismaSalesInvoiceRepository().getSalesInvoice((await params).id);
  if (!x) notFound();
  return (
    <main className="mx-auto max-w-5xl bg-white p-8 text-black print:p-0">
      <header className="mb-6 flex justify-between border-b pb-4">
        <div>
          <h1 className="text-2xl font-bold">Sales Invoice</h1>
          <p>{x.number}</p>
        </div>
        <div className="text-right">
          <p>{x.invoiceDate.toLocaleDateString()}</p>
          <p>Due: {x.dueDate.toLocaleDateString()}</p>
        </div>
      </header>
      <section className="mb-6 grid grid-cols-2 gap-4 text-sm">
        <div>
          <strong>Customer</strong>
          <p>{x.customerName}</p>
          <p>{x.billingAddress}</p>
        </div>
        <div>
          <strong>Sales Order</strong>
          <p>{x.salesOrderNumber}</p>
          <p>Terms: {x.paymentTermsDays ?? 0} days</p>
        </div>
      </section>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-y">
            <th>Product</th>
            <th>Cartons</th>
            <th>Loose</th>
            <th>Rate</th>
            <th>Discount / Tax</th>
            <th>Total</th>
          </tr>
        </thead>
        <tbody>
          {x.lines.map((l) => (
            <tr className="border-b" key={l.id}>
              <td>
                {l.itemCode} — {l.itemName}
              </td>
              <td>{l.cartons}</td>
              <td>{l.loosePieces}</td>
              <td>{l.cartonRate}</td>
              <td>
                {l.discount1Percent}% + {l.discount2Percent}% / {l.taxPercent}%
              </td>
              <td>{l.netAmount}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-5 text-right">
        Subtotal {x.subtotal} · Discount {x.discountTotal} · Tax {x.taxTotal} · Grand Total{" "}
        {x.grandTotal}
      </p>
      {x.notes && <p className="mt-6 text-sm">Notes: {x.notes}</p>}
    </main>
  );
}
