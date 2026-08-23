import { notFound } from "next/navigation";
import { PrintButton } from "@/components/purchasing/print-button";
import { formatMoney } from "@/modules/purchasing/domain/purchasing";
import { requirePermission } from "@/server/auth/server-guards";
import { PrismaPurchasingRepository } from "@/server/purchasing/prisma-purchasing-repository";

export default async function PrintPurchaseOrderPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requirePermission("purchasing.view");
  const order = await new PrismaPurchasingRepository().getPurchaseOrder((await params).id);
  if (!order) notFound();
  return (
    <main className="mx-auto max-w-5xl bg-white p-8 text-slate-950 print:max-w-none print:p-0">
      <div className="mb-6 flex justify-end">
        <PrintButton />
      </div>
      <header className="mb-8 flex justify-between border-b-2 border-slate-900 pb-5">
        <div>
          <h1 className="text-2xl font-bold">Factory ERP</h1>
          <p>Purchase Order</p>
        </div>
        <div className="text-right">
          <strong className="text-xl">{order.number}</strong>
          <p>{order.orderDate.toLocaleDateString()}</p>
          <p>{order.status.replaceAll("_", " ")}</p>
        </div>
      </header>
      <section className="mb-6 grid grid-cols-2 gap-8 text-sm">
        <div>
          <h2 className="mb-2 font-bold">Supplier</h2>
          <p>
            {order.supplierCode} - {order.supplierName}
          </p>
          <p>{order.supplierContactPerson}</p>
          <p>
            {order.supplierPhone} / {order.supplierEmail}
          </p>
          <p>
            {order.supplierAddress}, {order.supplierCity}
          </p>
        </div>
        <div>
          <p>
            <strong>Expected delivery:</strong>{" "}
            {order.expectedDeliveryDate?.toLocaleDateString() ?? "-"}
          </p>
          <p>
            <strong>Supplier reference:</strong> {order.supplierReference ?? "-"}
          </p>
          <p>
            <strong>Created by:</strong> {order.createdByName}
          </p>
          <p>
            <strong>Approved by:</strong> {order.approvedByName ?? "Pending"}
          </p>
        </div>
      </section>
      <table className="w-full border-collapse text-xs">
        <thead>
          <tr>
            {["#", "Item", "Quantity", "Rate / unit", "Discount", "Tax", "Total"].map((heading) => (
              <th className="border border-slate-400 p-2 text-left" key={heading}>
                {heading}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {order.lines.map((line) => (
            <tr key={line.id}>
              <td className="border p-2">{line.position}</td>
              <td className="border p-2">
                {line.itemCode} - {line.itemName}
              </td>
              <td className="border p-2">
                {line.orderedQuantity} {line.orderUnitSymbol}
              </td>
              <td className="border p-2">
                {formatMoney(line.unitRate)} / {line.orderUnitSymbol}
              </td>
              <td className="border p-2">
                {formatMoney(line.discountAmount)} ({line.discountPercent}%)
              </td>
              <td className="border p-2">
                {formatMoney(line.taxAmount)} ({line.taxPercent}%)
              </td>
              <td className="border p-2">{formatMoney(line.netAmount)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <dl className="ml-auto mt-5 grid max-w-sm grid-cols-2 gap-2 text-sm">
        <dt>Subtotal</dt>
        <dd className="text-right">{formatMoney(order.subtotal)}</dd>
        <dt>Discount</dt>
        <dd className="text-right">{formatMoney(order.discountTotal)}</dd>
        <dt>Tax</dt>
        <dd className="text-right">{formatMoney(order.taxTotal)}</dd>
        <dt className="font-bold">Grand total</dt>
        <dd className="text-right font-bold">{formatMoney(order.grandTotal)}</dd>
      </dl>
      <section className="mt-8 border-t pt-4 text-sm">
        <strong>Notes</strong>
        <p className="whitespace-pre-wrap">{order.notes ?? "-"}</p>
        {order.approvedAt && (
          <p className="mt-6">
            Approved by {order.approvedByName} on {order.approvedAt.toLocaleString()}
          </p>
        )}
      </section>
    </main>
  );
}
