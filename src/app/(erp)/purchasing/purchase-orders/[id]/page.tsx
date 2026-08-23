import Link from "next/link";
import { notFound } from "next/navigation";
import { ApproveOrderForm, CancelOrderForm } from "@/components/purchasing/purchase-order-actions";
import { PageHeader } from "@/components/layout/page-header";
import { Card } from "@/components/ui/card";
import { ResponsiveContainer } from "@/components/ui/responsive-container";
import { hasPermission } from "@/modules/access/domain/principal";
import { formatMoney } from "@/modules/purchasing/domain/purchasing";
import { requirePermission } from "@/server/auth/server-guards";
import { PrismaPurchasingRepository } from "@/server/purchasing/prisma-purchasing-repository";
import { PrismaGoodsReceiptRepository } from "@/server/purchasing/prisma-goods-receipt-repository";
import { approvePurchaseOrderAction, cancelPurchaseOrderAction } from "../actions";

export default async function PurchaseOrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const principal = await requirePermission("purchasing.view");
  const id = (await params).id;
  const [order, progress] = await Promise.all([
    new PrismaPurchasingRepository().getPurchaseOrder(id),
    new PrismaGoodsReceiptRepository().getPurchaseOrderProgress(id),
  ]);
  if (!order) notFound();
  const canManage = hasPermission(principal, "purchasing.manage");
  return (
    <ResponsiveContainer>
      <PageHeader
        title={order.number}
        description={`${order.status.replaceAll("_", " ")} purchase order for ${order.supplierName}`}
      />
      <div className="mb-4 flex flex-wrap gap-2">
        <Link
          className="rounded-lg border border-[var(--border)] px-4 py-2 text-sm font-semibold"
          href={`/purchasing/purchase-orders/${order.id}/print`}
        >
          Printable view
        </Link>
        {canManage && order.status === "DRAFT" && (
          <Link
            className="rounded-lg border border-[var(--border)] px-4 py-2 text-sm font-semibold"
            href={`/purchasing/purchase-orders/${order.id}/edit`}
          >
            Edit draft
          </Link>
        )}
        {canManage && ["APPROVED", "PARTIALLY_RECEIVED"].includes(order.status) && (
          <Link
            className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white"
            href={`/purchasing/goods-receiving/new?po=${order.id}`}
          >
            Create goods receipt
          </Link>
        )}
      </div>
      <Card className="mb-5 grid gap-4 p-5 md:grid-cols-2 xl:grid-cols-4">
        <Info label="Supplier" value={`${order.supplierCode} - ${order.supplierName}`} />
        <Info label="Contact" value={`${order.supplierContactPerson} / ${order.supplierPhone}`} />
        <Info label="Order date" value={order.orderDate.toLocaleDateString()} />
        <Info
          label="Expected delivery"
          value={order.expectedDeliveryDate?.toLocaleDateString() ?? "-"}
        />
        <Info label="Supplier reference" value={order.supplierReference ?? "-"} />
        <Info label="Created by" value={order.createdByName} />
        <Info
          label="Approved"
          value={
            order.approvedAt
              ? `${order.approvedByName} - ${order.approvedAt.toLocaleString()}`
              : "Pending"
          }
        />
        <Info label="Status" value={order.status.replaceAll("_", " ")} />
      </Card>
      <OrderLines order={order} />
      <ReceiptProgress progress={progress} />
      <Card className="mt-5 p-5">
        <h2 className="mb-2 font-semibold">Notes</h2>
        <p className="whitespace-pre-wrap text-sm text-[var(--muted)]">{order.notes ?? "-"}</p>
        {order.cancelledAt && (
          <div className="mt-4 border-t pt-4 text-sm text-red-800">
            <strong>
              Cancelled by {order.cancelledByName} on {order.cancelledAt.toLocaleString()}
            </strong>
            <p>{order.cancellationReason}</p>
          </div>
        )}
      </Card>
      {canManage && ["DRAFT", "APPROVED"].includes(order.status) && (
        <Card className="mt-5 space-y-4 p-5">
          <h2 className="font-semibold">Lifecycle actions</h2>
          {order.status === "DRAFT" && (
            <ApproveOrderForm action={approvePurchaseOrderAction} id={order.id} />
          )}
          <CancelOrderForm action={cancelPurchaseOrderAction} id={order.id} />
        </Card>
      )}
    </ResponsiveContainer>
  );
}

function ReceiptProgress({
  progress,
}: {
  progress: Awaited<ReturnType<PrismaGoodsReceiptRepository["getPurchaseOrderProgress"]>>;
}) {
  return (
    <Card className="mt-5 overflow-hidden">
      <div className="border-b p-5">
        <h2 className="font-semibold">Receiving and QC progress</h2>
        <p className="mt-1 text-xs text-[var(--muted)]">
          Remaining to receive = ordered - accepted - pending QC. Rejected quantity reopens supply.
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[65rem] text-left text-sm">
          <thead className="bg-[var(--surface)]">
            <tr>
              <th className="p-3">Item</th>
              <th className="p-3">Ordered</th>
              <th className="p-3">Pending QC</th>
              <th className="p-3">Accepted</th>
              <th className="p-3">Returned accepted</th>
              <th className="p-3">Rejected</th>
              <th className="p-3">Remaining now</th>
              <th className="p-3">Remaining fulfilment</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {progress.lines.map((line) => (
              <tr key={line.id}>
                <td className="p-3">
                  <strong>{line.itemCode}</strong>
                  <span className="block text-xs">{line.itemName}</span>
                </td>
                {[
                  line.orderedQuantity,
                  line.pendingQcQuantity,
                  line.acceptedQuantity,
                  line.returnedAcceptedQuantity,
                  line.rejectedQuantity,
                  line.remainingToReceive,
                  line.remainingToFulfil,
                ].map((value, index) => (
                  <td className="p-3" key={index}>
                    {value} {line.canonicalUnitSymbol}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="border-t p-5">
        <h3 className="mb-2 text-sm font-semibold">Linked goods receipts</h3>
        {progress.goodsReceipts.length ? (
          <div className="flex flex-wrap gap-2">
            {progress.goodsReceipts.map((receipt) => (
              <Link
                className="rounded-lg border px-3 py-2 text-xs"
                href={`/purchasing/goods-receiving/${receipt.id}`}
                key={receipt.id}
              >
                {receipt.number} - {receipt.status.replaceAll("_", " ")} - {receipt.warehouseName}
              </Link>
            ))}
          </div>
        ) : (
          <p className="text-sm text-[var(--muted)]">No goods receipts yet.</p>
        )}
      </div>
    </Card>
  );
}

function OrderLines({
  order,
}: {
  order: NonNullable<Awaited<ReturnType<PrismaPurchasingRepository["getPurchaseOrder"]>>>;
}) {
  return (
    <Card className="overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[75rem] text-left text-sm">
          <thead className="bg-[var(--surface)]">
            <tr>
              <th className="p-3">#</th>
              <th className="p-3">Item</th>
              <th className="p-3">Ordered</th>
              <th className="p-3">Canonical</th>
              <th className="p-3">Rate</th>
              <th className="p-3">Gross</th>
              <th className="p-3">Discount</th>
              <th className="p-3">Tax</th>
              <th className="p-3">Net</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border)]">
            {order.lines.map((line) => (
              <tr key={line.id}>
                <td className="p-3">{line.position}</td>
                <td className="p-3">
                  <strong>{line.itemCode}</strong>
                  <span className="block text-xs text-[var(--muted)]">{line.itemName}</span>
                </td>
                <td className="p-3">
                  {line.orderedQuantity} {line.orderUnitSymbol}
                </td>
                <td className="p-3">
                  {line.normalizedQuantity} {line.canonicalUnitSymbol}
                </td>
                <td className="p-3">
                  {formatMoney(line.unitRate)} / {line.orderUnitSymbol}
                </td>
                <td className="p-3">{formatMoney(line.grossAmount)}</td>
                <td className="p-3">
                  {formatMoney(line.discountAmount)} ({line.discountPercent}%)
                </td>
                <td className="p-3">
                  {formatMoney(line.taxAmount)} ({line.taxPercent}%)
                </td>
                <td className="p-3 font-semibold">{formatMoney(line.netAmount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <dl className="ml-auto grid max-w-md grid-cols-2 gap-2 border-t p-5 text-sm">
        <dt>Subtotal</dt>
        <dd className="text-right">{formatMoney(order.subtotal)}</dd>
        <dt>Discount</dt>
        <dd className="text-right">{formatMoney(order.discountTotal)}</dd>
        <dt>Tax</dt>
        <dd className="text-right">{formatMoney(order.taxTotal)}</dd>
        <dt className="font-bold">Grand total</dt>
        <dd className="text-right font-bold">{formatMoney(order.grandTotal)}</dd>
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
