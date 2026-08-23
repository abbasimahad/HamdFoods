import Link from "next/link";
import { notFound } from "next/navigation";
import {
  CancelGoodsReceiptForm,
  PostGoodsReceiptForm,
} from "@/components/purchasing/goods-receipt-actions";
import { PageHeader } from "@/components/layout/page-header";
import { Card } from "@/components/ui/card";
import { ResponsiveContainer } from "@/components/ui/responsive-container";
import { hasPermission } from "@/modules/access/domain/principal";
import { requirePermission } from "@/server/auth/server-guards";
import { PrismaGoodsReceiptRepository } from "@/server/purchasing/prisma-goods-receipt-repository";
import { cancelGoodsReceiptAction, postGoodsReceiptAction } from "../actions";
export default async function GoodsReceiptDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const principal = await requirePermission("purchasing.view");
  const receipt = await new PrismaGoodsReceiptRepository().getGoodsReceipt((await params).id);
  if (!receipt) notFound();
  const canManage = hasPermission(principal, "purchasing.manage");
  return (
    <ResponsiveContainer>
      <PageHeader
        title={receipt.number}
        description={`${receipt.status.replaceAll("_", " ")} receipt for ${receipt.supplierName}`}
      />
      <div className="mb-4 flex flex-wrap gap-2">
        {canManage && receipt.status === "DRAFT" && (
          <Link
            className="rounded-lg border px-4 py-2 text-sm font-semibold"
            href={`/purchasing/goods-receiving/${receipt.id}/edit`}
          >
            Edit draft
          </Link>
        )}
        {canManage && receipt.status === "POSTED" && (
          <Link
            className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white"
            href={`/purchasing/goods-receiving/${receipt.id}/qc`}
          >
            Perform QC
          </Link>
        )}
      </div>
      <Card className="mb-5 grid gap-4 p-5 md:grid-cols-2 xl:grid-cols-4">
        <Info label="Receipt purpose" value={receipt.purpose.replaceAll("_", " ")} />
        {receipt.purchaseReturnId && (
          <div>
            <dt className="text-xs uppercase tracking-wide text-[var(--muted)]">Purchase return</dt>
            <dd className="mt-1 text-sm">
              <Link
                className="text-[var(--accent)]"
                href={`/purchasing/purchase-returns/${receipt.purchaseReturnId}`}
              >
                {receipt.purchaseReturnNumber}
              </Link>
            </dd>
          </div>
        )}
        <Info label="Purchase order" value={receipt.purchaseOrderNumber} />
        <Info label="Supplier" value={`${receipt.supplierCode} - ${receipt.supplierName}`} />
        <Info label="Warehouse" value={`${receipt.warehouseCode} - ${receipt.warehouseName}`} />
        <Info label="Receipt date" value={receipt.receiptDate.toLocaleString()} />
        <Info label="Delivery / challan" value={receipt.supplierDeliveryNumber ?? "-"} />
        <Info label="Vehicle / reference" value={receipt.vehicleReference ?? "-"} />
        <Info label="Received by" value={receipt.receivedByName} />
        <Info
          label="Posted"
          value={
            receipt.postedAt
              ? `${receipt.postedByName} - ${receipt.postedAt.toLocaleString()}`
              : "Not posted"
          }
        />
        <Info
          label="QC"
          value={
            receipt.qcCompletedAt
              ? `${receipt.qcByName} - ${receipt.qcCompletedAt.toLocaleString()}`
              : receipt.status === "POSTED"
                ? "Pending"
                : "-"
          }
        />
      </Card>
      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[75rem] text-left text-sm">
            <thead className="bg-[var(--surface)]">
              <tr>
                <th className="p-3">Item</th>
                <th className="p-3">Ordered</th>
                <th className="p-3">Received</th>
                <th className="p-3">Canonical</th>
                <th className="p-3">Supplier lot</th>
                <th className="p-3">Expiry</th>
                <th className="p-3">Accepted</th>
                <th className="p-3">Rejected</th>
                <th className="p-3">QC result</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {receipt.lines.map((line) => (
                <tr key={line.id}>
                  <td className="p-3">
                    <strong>{line.itemCode}</strong>
                    <span className="block text-xs">{line.itemName}</span>
                  </td>
                  <td className="p-3">
                    {line.orderedQuantity} {line.canonicalUnitSymbol}
                  </td>
                  <td className="p-3">
                    {line.enteredQuantity} {line.enteredUnitSymbol}
                  </td>
                  <td className="p-3">
                    {line.normalizedQuantity} {line.canonicalUnitSymbol}
                  </td>
                  <td className="p-3">{line.supplierLotNumber ?? "-"}</td>
                  <td className="p-3">{line.expiryDate?.toLocaleDateString() ?? "-"}</td>
                  <td className="p-3">
                    {line.acceptedQuantity} {line.canonicalUnitSymbol}
                  </td>
                  <td className="p-3">
                    {line.rejectedQuantity} {line.canonicalUnitSymbol}
                  </td>
                  <td className="p-3">
                    {line.rejectionReason?.replaceAll("_", " ") ??
                      (receipt.status === "QC_COMPLETED" ? "ACCEPTED" : "Pending")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <Card className="mt-5 p-5">
        <h2 className="font-semibold">Notes</h2>
        <p className="mt-2 whitespace-pre-wrap text-sm">{receipt.notes ?? "-"}</p>
        {receipt.cancelledAt && (
          <p className="mt-4 text-sm text-red-700">
            Cancelled by {receipt.cancelledByName}: {receipt.cancellationReason}
          </p>
        )}
      </Card>
      {canManage && receipt.status === "DRAFT" && (
        <Card className="mt-5 space-y-4 p-5">
          <PostGoodsReceiptForm action={postGoodsReceiptAction} id={receipt.id} />
          <CancelGoodsReceiptForm action={cancelGoodsReceiptAction} id={receipt.id} />
        </Card>
      )}
    </ResponsiveContainer>
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
