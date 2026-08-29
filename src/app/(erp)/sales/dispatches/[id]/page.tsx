import Link from "next/link";
import { notFound } from "next/navigation";
import {
  CancelDispatchForm,
  ConfirmDeliveryForm,
  PostSalesDispatchForm,
} from "@/components/sales/sales-dispatch-actions";
import { PageHeader } from "@/components/layout/page-header";
import { Card } from "@/components/ui/card";
import { ResponsiveContainer } from "@/components/ui/responsive-container";
import { hasPermission } from "@/modules/access/domain/principal";
import { requirePermission } from "@/server/auth/server-guards";
import { PrismaSalesDispatchRepository } from "@/server/sales/prisma-sales-dispatch-repository";
import {
  cancelSalesDispatchAction,
  confirmSalesDispatchDeliveryAction,
  postSalesDispatchAction,
} from "../actions";

export default async function SalesDispatchDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const principal = await requirePermission("sales.view");
  const dispatch = await new PrismaSalesDispatchRepository().getSalesDispatch((await params).id);
  if (!dispatch) notFound();
  const canManage = hasPermission(principal, "sales.manage");
  return (
    <ResponsiveContainer>
      <PageHeader
        title={dispatch.number}
        description={`Delivery note / gate pass — ${dispatch.status.replaceAll("_", " ")}. Posted invoices finalize its IN TRANSIT stock.`}
      />
      <div className="mb-4 flex flex-wrap gap-3">
        {canManage && dispatch.status === "DRAFT" && (
          <Link
            className="rounded-lg border px-4 py-2 text-sm font-semibold"
            href={`/sales/dispatches/${dispatch.id}/edit`}
          >
            Edit draft
          </Link>
        )}
        {canManage && ["POSTED", "DELIVERED"].includes(dispatch.status) && (
          <Link
            className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white"
            href={`/sales/invoices/new?order=${dispatch.salesOrderId}`}
          >
            Create invoice
          </Link>
        )}
        <Link
          className="rounded-lg border px-4 py-2 text-sm font-semibold"
          href={`/sales/dispatches/${dispatch.id}/print`}
        >
          Print delivery note
        </Link>
        <Link
          className="rounded-lg border px-4 py-2 text-sm font-semibold"
          href={`/sales/orders/${dispatch.salesOrderId}`}
        >
          View Sales Order
        </Link>
      </div>
      <Card className="mb-5 grid gap-4 p-5 md:grid-cols-2 xl:grid-cols-4">
        <Info label="Sales order" value={dispatch.salesOrderNumber} />
        <Info label="Customer" value={`${dispatch.customerCode} — ${dispatch.customerName}`} />
        <Info
          label="Dispatch / warehouse"
          value={`${dispatch.dispatchAt.toLocaleDateString()} / ${dispatch.warehouseName}`}
        />
        <Info label="Status" value={dispatch.status} />
        <Info label="Delivery address" value={dispatch.deliveryAddress} />
        <Info
          label="Vehicle / driver"
          value={[dispatch.vehicleNumber, dispatch.driverName].filter(Boolean).join(" / ") || "-"}
        />
        <Info
          label="Transport / gate pass"
          value={
            [dispatch.transporter, dispatch.gatePassReference].filter(Boolean).join(" / ") || "-"
          }
        />
        <Info
          label="Salesperson / route"
          value={[dispatch.salespersonName, dispatch.routeName].filter(Boolean).join(" / ") || "-"}
        />
        <Info label="Created by" value={dispatch.createdByName} />
        <Info
          label="Posted"
          value={
            dispatch.postedByName
              ? `${dispatch.postedByName} on ${dispatch.postedAt?.toLocaleString()}`
              : "Not posted"
          }
        />
        <Info
          label="Delivered"
          value={
            dispatch.deliveredByName
              ? `${dispatch.deliveredByName} on ${dispatch.deliveredAt?.toLocaleString()}`
              : "Not confirmed"
          }
        />
      </Card>
      <DispatchLines dispatch={dispatch} />
      {dispatch.notes && (
        <Card className="mt-5 p-5">
          <h2 className="font-semibold">Dispatch notes</h2>
          <p className="mt-2 text-sm">{dispatch.notes}</p>
        </Card>
      )}
      {dispatch.status === "DELIVERED" && (
        <Card className="mt-5 p-5">
          <strong>Receiver: {dispatch.receiverName ?? "Not recorded"}</strong>
          {dispatch.deliveryNotes && <p className="mt-2 text-sm">{dispatch.deliveryNotes}</p>}
        </Card>
      )}
      {dispatch.status === "CANCELLED" && (
        <Card className="mt-5 p-5 text-red-800">
          <strong>
            Cancelled by {dispatch.cancelledByName} on {dispatch.cancelledAt?.toLocaleString()}
          </strong>
          <p>{dispatch.cancellationReason}</p>
        </Card>
      )}
      {canManage && (
        <Card className="mt-5 space-y-4 p-5">
          <h2 className="font-semibold">Lifecycle actions</h2>
          {dispatch.status === "DRAFT" && (
            <>
              <PostSalesDispatchForm action={postSalesDispatchAction} id={dispatch.id} />
              <CancelDispatchForm action={cancelSalesDispatchAction} id={dispatch.id} />
            </>
          )}
          {dispatch.status === "POSTED" && (
            <ConfirmDeliveryForm action={confirmSalesDispatchDeliveryAction} id={dispatch.id} />
          )}
        </Card>
      )}
    </ResponsiveContainer>
  );
}
function DispatchLines({
  dispatch,
}: {
  dispatch: NonNullable<Awaited<ReturnType<PrismaSalesDispatchRepository["getSalesDispatch"]>>>;
}) {
  return (
    <Card className="overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[85rem] text-left text-sm">
          <thead className="bg-[var(--surface)]">
            <tr>
              <th className="p-3">Product</th>
              <th className="p-3">Cartons / loose</th>
              <th className="p-3">Dispatch pieces</th>
              <th className="p-3">Order / dispatched / remaining</th>
              <th className="p-3">Invoiced / invoiceable</th>
              <th className="p-3">Linked invoices</th>
              <th className="p-3">Production lot allocations</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {dispatch.lines.map((line) => (
              <tr key={line.id}>
                <td className="p-3">
                  <strong>{line.itemCode}</strong>
                  <span className="block text-xs">{line.itemName}</span>
                </td>
                <td className="p-3">
                  {line.cartons} / {line.loosePieces}
                </td>
                <td className="p-3 font-semibold">{line.totalPieces}</td>
                <td className="p-3">
                  {line.orderedPieces} / {line.dispatchedPieces} / {line.remainingPieces}
                </td>
                <td className="p-3">
                  {line.invoicedPieces} / {line.invoiceablePieces}
                </td>
                <td className="p-3">
                  {line.invoices.length
                    ? line.invoices.map((invoice) => (
                        <Link
                          className="block text-[var(--accent)]"
                          href={`/sales/invoices/${invoice.id}`}
                          key={invoice.id}
                        >
                          {invoice.number} — {invoice.quantity} pcs
                        </Link>
                      ))
                    : "Not invoiced"}
                </td>
                <td className="p-3">
                  {line.allocations.map((allocation) => (
                    <span className="block" key={`${allocation.id}-${allocation.quantity}`}>
                      {allocation.lotNumber} — {allocation.quantity} pcs{" "}
                      {allocation.expiryDate
                        ? `(expires ${new Date(allocation.expiryDate).toLocaleDateString()})`
                        : ""}
                    </span>
                  ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
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
