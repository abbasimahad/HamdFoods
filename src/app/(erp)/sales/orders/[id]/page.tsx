import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ApproveSalesOrderForm,
  CancelSalesOrderForm,
  ReserveRedeliveryStockForm,
} from "@/components/sales/sales-order-actions";
import { PageHeader } from "@/components/layout/page-header";
import { Card } from "@/components/ui/card";
import { ResponsiveContainer } from "@/components/ui/responsive-container";
import { hasPermission } from "@/modules/access/domain/principal";
import { formatSalesMoney } from "@/modules/sales/domain/sales-orders";
import { requirePermission } from "@/server/auth/server-guards";
import { PrismaSalesOrderRepository } from "@/server/sales/prisma-sales-order-repository";
import {
  approveSalesOrderAction,
  cancelSalesOrderAction,
  reserveRedeliveryStockAction,
} from "../actions";
export default async function SalesOrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const principal = await requirePermission("sales.view");
  const order = await new PrismaSalesOrderRepository().getSalesOrder((await params).id);
  if (!order) notFound();
  const canManage = hasPermission(principal, "sales.manage");
  const canCancel = ["DRAFT", "APPROVED"].includes(order.status);
  const hasUnreservedRedelivery = order.lines.some(
    (line) => line.redeliveryReservationPieces !== "0",
  );
  return (
    <ResponsiveContainer>
      <PageHeader
        title={order.number}
        description={`Sales order ${order.status.replaceAll("_", " ")}; no dispatch, receivable, revenue, or COGS effect.`}
      />
      <div className="mb-4 flex flex-wrap gap-3">
        {canManage && order.status === "DRAFT" && (
          <Link
            className="rounded-lg border px-4 py-2 text-sm font-semibold"
            href={`/sales/orders/${order.id}/edit`}
          >
            Edit draft
          </Link>
        )}
        <Link
          className="rounded-lg border px-4 py-2 text-sm font-semibold"
          href={`/sales/orders/${order.id}/print`}
        >
          Print
        </Link>
      </div>
      <Card className="mb-5 grid gap-4 p-5 md:grid-cols-2 xl:grid-cols-4">
        <Info label="Customer" value={`${order.customerCode} - ${order.customerName}`} />
        <Info label="Salesperson" value={order.salespersonName ?? "-"} />
        <Info
          label="Area / route"
          value={[order.areaName, order.routeName].filter(Boolean).join(" / ")}
        />
        <Info label="Warehouse" value={order.warehouseName} />
        <Info
          label="Order / delivery"
          value={`${order.orderDate.toLocaleDateString()} / ${order.deliveryDate?.toLocaleDateString() ?? "-"}`}
        />
        <Info
          label="Credit limit / terms"
          value={`${order.customerCreditLimit ? formatSalesMoney(order.customerCreditLimit) : "-"} / ${order.paymentTermsDays ?? "-"} days`}
        />
        <Info label="Created by" value={order.createdByName} />
        <Info
          label="Approval"
          value={
            order.approvedByName
              ? `${order.approvedByName} on ${order.approvedAt?.toLocaleString()}`
              : "Pending"
          }
        />
      </Card>
      <OrderLines order={order} />
      {order.notes && (
        <Card className="mt-5 p-5">
          <h2 className="font-semibold">Notes</h2>
          <p className="mt-2 text-sm">{order.notes}</p>
        </Card>
      )}
      {order.status === "CANCELLED" && (
        <Card className="mt-5 p-5 text-red-800">
          <strong>
            Cancelled by {order.cancelledByName} on {order.cancelledAt?.toLocaleString()}
          </strong>
          <p>{order.cancellationReason}</p>
        </Card>
      )}
      {canManage && (canCancel || hasUnreservedRedelivery) && (
        <Card className="mt-5 space-y-4 p-5">
          <h2 className="font-semibold">Lifecycle actions</h2>
          {order.status === "DRAFT" && (
            <ApproveSalesOrderForm action={approveSalesOrderAction} id={order.id} />
          )}
          {hasUnreservedRedelivery && (
            <ReserveRedeliveryStockForm action={reserveRedeliveryStockAction} id={order.id} />
          )}
          {canCancel && <CancelSalesOrderForm action={cancelSalesOrderAction} id={order.id} />}
        </Card>
      )}
    </ResponsiveContainer>
  );
}
function OrderLines({
  order,
}: {
  order: Awaited<ReturnType<PrismaSalesOrderRepository["getSalesOrder"]>> & {};
}) {
  if (!order) return null;
  return (
    <Card className="overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[96rem] text-left text-sm">
          <thead className="bg-[var(--surface)]">
            <tr>
              <th className="p-3">Product</th>
              <th className="p-3">Cartons / loose</th>
              <th className="p-3">Pieces</th>
              <th className="p-3">Carton / piece rate</th>
              <th className="p-3">Discounts / tax</th>
              <th className="p-3">Total</th>
              <th className="p-3">Delivered / refused / remaining</th>
              <th className="p-3">Available now</th>
              <th className="p-3">Reserved / needed for redelivery</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {order.lines.map((line) => (
              <tr key={line.id}>
                <td className="p-3">
                  <strong>{line.itemCode}</strong>
                  <span className="block text-xs">{line.itemName}</span>
                </td>
                <td className="p-3">
                  {line.cartons} / {line.loosePieces}
                </td>
                <td className="p-3">{line.totalPieces}</td>
                <td className="p-3">
                  {formatSalesMoney(line.cartonRate)} / {formatSalesMoney(line.pieceRate)}
                </td>
                <td className="p-3">
                  {line.discount1Percent}% + {line.discount2Percent}% / {line.taxPercent}%
                </td>
                <td className="p-3 font-semibold">{formatSalesMoney(line.netAmount)}</td>
                <td className="p-3">
                  {line.dispatchedPieces} / {line.refusedPieces} / {line.remainingDeliveryPieces}
                </td>
                <td className="p-3">{line.availablePieces} pcs</td>
                <td className="p-3">
                  {line.reservedPieces} / {line.redeliveryReservationPieces} pcs
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <dl className="ml-auto grid max-w-md grid-cols-2 gap-2 border-t p-5 text-sm">
        <dt>Subtotal</dt>
        <dd className="text-right">{formatSalesMoney(order.subtotal)}</dd>
        <dt>Discount</dt>
        <dd className="text-right">{formatSalesMoney(order.discountTotal)}</dd>
        <dt>Tax</dt>
        <dd className="text-right">{formatSalesMoney(order.taxTotal)}</dd>
        <dt className="font-bold">Grand total</dt>
        <dd className="text-right font-bold">{formatSalesMoney(order.grandTotal)}</dd>
      </dl>
    </Card>
  );
}
function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-[var(--muted)]">{label}</dt>
      <dd className="mt-1 text-sm">{value}</dd>
    </div>
  );
}
