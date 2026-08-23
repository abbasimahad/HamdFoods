import Link from "next/link";
import { notFound } from "next/navigation";
import {
  CancelPurchaseReturnForm,
  PostPurchaseReturnForm,
} from "@/components/purchasing/purchase-return-actions";
import { PageHeader } from "@/components/layout/page-header";
import { Card } from "@/components/ui/card";
import { ResponsiveContainer } from "@/components/ui/responsive-container";
import { hasPermission } from "@/modules/access/domain/principal";
import { requirePermission } from "@/server/auth/server-guards";
import { PrismaPurchaseReturnRepository } from "@/server/purchasing/prisma-purchase-return-repository";
import { cancelPurchaseReturnAction, postPurchaseReturnAction } from "../actions";

export default async function PurchaseReturnDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const principal = await requirePermission("purchasing.view");
  const record = await new PrismaPurchaseReturnRepository().getPurchaseReturn((await params).id);
  if (!record) notFound();
  const canManage = hasPermission(principal, "purchasing.manage");
  return (
    <ResponsiveContainer>
      <PageHeader
        title={record.number}
        description={`${record.status.replaceAll("_", " ")} physical supplier return`}
      />
      {canManage && record.status === "DRAFT" && (
        <div className="mb-4">
          <Link
            className="rounded-lg border px-4 py-2 text-sm font-semibold"
            href={`/purchasing/purchase-returns/${record.id}/edit`}
          >
            Edit draft
          </Link>
        </div>
      )}
      <Card className="mb-5 grid gap-4 p-5 md:grid-cols-2 xl:grid-cols-4">
        <Info label="Supplier" value={`${record.supplierCode} - ${record.supplierName}`} />
        <Linked
          label="Purchase order"
          href={`/purchasing/purchase-orders/${record.purchaseOrderId}`}
          value={record.purchaseOrderNumber}
        />
        <Linked
          label="Original GRN"
          href={`/purchasing/goods-receiving/${record.originalGoodsReceiptId}`}
          value={record.originalGoodsReceiptNumber}
        />
        <Info label="Warehouse" value={record.sourceWarehouseName} />
        <Info label="Return date" value={record.returnDate.toLocaleDateString()} />
        <Info label="Supplier reference" value={record.supplierReturnReference ?? "-"} />
        <Info label="Created by" value={record.createdByName} />
        <Info
          label="Posted"
          value={
            record.postedAt
              ? `${record.postedByName} - ${record.postedAt.toLocaleString()}`
              : "Not posted"
          }
        />
      </Card>
      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[85rem] text-left text-sm">
            <thead className="bg-[var(--surface)]">
              <tr>
                <th className="p-3">Item</th>
                <th className="p-3">Lot</th>
                <th className="p-3">Original source</th>
                <th className="p-3">Returned</th>
                <th className="p-3">Reason</th>
                <th className="p-3">Replacement expected</th>
                <th className="p-3">Received</th>
                <th className="p-3">Accepted</th>
                <th className="p-3">Remaining</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {record.lines.map((line) => (
                <tr key={line.id}>
                  <td className="p-3">
                    <strong>{line.itemCode}</strong>
                    <span className="block text-xs">{line.itemName}</span>
                  </td>
                  <td className="p-3">{line.supplierLotNumber ?? "Internal lot"}</td>
                  <td className="p-3">{line.source.replaceAll("_", " ")}</td>
                  <td className="p-3">
                    {line.enteredQuantity} {line.enteredUnitSymbol}
                    <span className="block text-xs">
                      {line.normalizedQuantity} {line.canonicalUnitSymbol}
                    </span>
                  </td>
                  <td className="p-3">{line.reason.replaceAll("_", " ")}</td>
                  <td className="p-3">{line.replacementExpected ? "Yes" : "No"}</td>
                  <td className="p-3">
                    {line.replacementReceivedQuantity} {line.canonicalUnitSymbol}
                  </td>
                  <td className="p-3">
                    {line.replacementAcceptedQuantity} {line.canonicalUnitSymbol}
                  </td>
                  <td className="p-3">
                    {line.replacementRemainingQuantity} {line.canonicalUnitSymbol}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <Card className="mt-5 p-5">
        <h2 className="font-semibold">Related replacement GRNs</h2>
        {record.replacementGoodsReceipts.length ? (
          <div className="mt-3 flex flex-wrap gap-2">
            {record.replacementGoodsReceipts.map((receipt) => (
              <Link
                className="rounded-lg border px-3 py-2 text-xs"
                href={`/purchasing/goods-receiving/${receipt.id}`}
                key={receipt.id}
              >
                {receipt.number} - {receipt.status.replaceAll("_", " ")}
              </Link>
            ))}
          </div>
        ) : (
          <p className="mt-2 text-sm text-[var(--muted)]">No replacement goods receipts.</p>
        )}
        {record.status === "AWAITING_REPLACEMENT" && canManage && (
          <Link
            className="mt-4 inline-block rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white"
            href="/purchasing/goods-receiving/new"
          >
            Receive replacement through GRN + QC
          </Link>
        )}
      </Card>
      <Card className="mt-5 p-5">
        <h2 className="font-semibold">Notes</h2>
        <p className="mt-2 whitespace-pre-wrap text-sm">{record.reasonNotes ?? "-"}</p>
        {record.cancelledAt && (
          <p className="mt-4 text-sm text-red-700">
            Cancelled by {record.cancelledByName}: {record.cancellationReason}
          </p>
        )}
      </Card>
      {canManage && record.status === "DRAFT" && (
        <Card className="mt-5 space-y-4 p-5">
          <PostPurchaseReturnForm action={postPurchaseReturnAction} id={record.id} />
          <CancelPurchaseReturnForm action={cancelPurchaseReturnAction} id={record.id} />
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
function Linked({ label, href, value }: { label: string; href: string; value: string }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-[var(--muted)]">{label}</dt>
      <dd className="mt-1 text-sm">
        <Link className="text-[var(--accent)]" href={href}>
          {value}
        </Link>
      </dd>
    </div>
  );
}
