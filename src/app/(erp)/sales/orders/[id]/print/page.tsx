import { notFound } from "next/navigation";
import { formatSalesMoney } from "@/modules/sales/domain/sales-orders";
import { requirePermission } from "@/server/auth/server-guards";
import { PrismaSalesOrderRepository } from "@/server/sales/prisma-sales-order-repository";
export default async function PrintSalesOrderPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission("sales.view");
  const order = await new PrismaSalesOrderRepository().getSalesOrder((await params).id);
  if (!order) notFound();
  return (
    <main className="mx-auto max-w-5xl bg-white p-8 text-black print:max-w-none print:p-0">
      <header className="mb-8 flex justify-between border-b pb-5">
        <div>
          <h1 className="text-2xl font-bold">Sales Order</h1>
          <p>{order.number}</p>
        </div>
        <div className="text-right text-sm">
          <p>{order.orderDate.toLocaleDateString()}</p>
          <p>Status: {order.status}</p>
        </div>
      </header>
      <section className="mb-6 grid gap-4 text-sm md:grid-cols-3">
        <div>
          <strong>Customer</strong>
          <p>{order.customerName}</p>
          <p>{order.customerCode}</p>
        </div>
        <div>
          <strong>Sales assignment</strong>
          <p>{order.salespersonName ?? "-"}</p>
          <p>{[order.areaName, order.routeName].filter(Boolean).join(" / ")}</p>
        </div>
        <div>
          <strong>Delivery</strong>
          <p>Warehouse: {order.warehouseName}</p>
          <p>Requested: {order.deliveryDate?.toLocaleDateString() ?? "-"}</p>
        </div>
      </section>
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-y">
            <th className="p-2 text-left">Product</th>
            <th className="p-2 text-right">Cartons</th>
            <th className="p-2 text-right">Loose</th>
            <th className="p-2 text-right">Rate</th>
            <th className="p-2 text-right">Discount / tax</th>
            <th className="p-2 text-right">Total</th>
          </tr>
        </thead>
        <tbody>
          {order.lines.map((line) => (
            <tr className="border-b" key={line.id}>
              <td className="p-2">
                {line.itemCode} - {line.itemName}
              </td>
              <td className="p-2 text-right">{line.cartons}</td>
              <td className="p-2 text-right">{line.loosePieces}</td>
              <td className="p-2 text-right">{formatSalesMoney(line.cartonRate)}</td>
              <td className="p-2 text-right">
                {line.discount1Percent}% + {line.discount2Percent}% / {line.taxPercent}%
              </td>
              <td className="p-2 text-right">{formatSalesMoney(line.netAmount)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <dl className="ml-auto mt-5 grid max-w-xs grid-cols-2 gap-2 text-sm">
        <dt>Subtotal</dt>
        <dd className="text-right">{formatSalesMoney(order.subtotal)}</dd>
        <dt>Discount</dt>
        <dd className="text-right">{formatSalesMoney(order.discountTotal)}</dd>
        <dt>Tax</dt>
        <dd className="text-right">{formatSalesMoney(order.taxTotal)}</dd>
        <dt className="font-bold">Grand total</dt>
        <dd className="text-right font-bold">{formatSalesMoney(order.grandTotal)}</dd>
      </dl>
      {order.notes && (
        <section className="mt-8 text-sm">
          <strong>Notes</strong>
          <p>{order.notes}</p>
        </section>
      )}
      <footer className="mt-10 border-t pt-4 text-xs">
        Created by {order.createdByName}.{" "}
        {order.approvedByName
          ? `Approved by ${order.approvedByName}.`
          : "Draft order; stock is not reserved."}
      </footer>
    </main>
  );
}
