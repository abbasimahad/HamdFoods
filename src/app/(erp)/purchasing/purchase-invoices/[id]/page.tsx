import Link from "next/link";
import { notFound } from "next/navigation";
import {
  CancelPurchaseInvoiceForm,
  PostPurchaseInvoiceForm,
  ReversePurchaseInvoiceForm,
} from "@/components/purchasing/purchase-invoice-actions";
import { PageHeader } from "@/components/layout/page-header";
import { Card } from "@/components/ui/card";
import { formatDateTimeUtc } from "@/components/ui/format-datetime";
import { ResponsiveContainer } from "@/components/ui/responsive-container";
import { hasPermission } from "@/modules/access/domain/principal";
import { requirePermission } from "@/server/auth/server-guards";
import { PrismaPurchaseInvoiceRepository } from "@/server/purchasing/prisma-purchase-invoice-repository";
import {
  cancelPurchaseInvoiceAction,
  postPurchaseInvoiceAction,
  reversePurchaseInvoiceAction,
} from "../actions";

export default async function PurchaseInvoiceDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const principal = await requirePermission("purchasing.view");
  const record = await new PrismaPurchaseInvoiceRepository().getPurchaseInvoice((await params).id);
  if (!record) notFound();
  const canManage = hasPermission(principal, "purchasing.manage");
  const netVariance = Number(record.priceVarianceTotal) + Number(record.taxVarianceTotal);
  return (
    <ResponsiveContainer>
      <PageHeader title={record.number} description={`${record.status} purchase invoice`} />
      {canManage && record.status === "DRAFT" && (
        <div className="mb-4">
          <Link
            className="rounded-lg border px-4 py-2 text-sm font-semibold"
            href={`/purchasing/purchase-invoices/${record.id}/edit`}
          >
            Edit draft
          </Link>
        </div>
      )}
      <Card className="mb-5 grid gap-4 p-5 md:grid-cols-2 xl:grid-cols-4">
        <Info label="Supplier" value={`${record.supplierCode} - ${record.supplierName}`} />
        <Info label="Supplier invoice number" value={record.supplierInvoiceNumber} />
        <Info label="Invoice date" value={record.invoiceDate.toLocaleDateString()} />
        <Info
          label="Due date"
          value={
            record.dueDate ? `${record.dueDate.toLocaleDateString()} (informational only)` : "-"
          }
        />
        <Info label="Subtotal" value={record.subtotal} />
        <Info label="Tax total" value={record.taxTotal} />
        <Info label="Grand total" value={record.grandTotal} />
        <Info
          label="Posted price/tax variance"
          value={record.status === "DRAFT" ? "Not yet posted" : netVariance.toFixed(6)}
        />
        <Info label="Created by" value={record.createdByName} />
        <Info
          label="Posted"
          value={
            record.postedAt
              ? `${record.postedByName} - ${formatDateTimeUtc(record.postedAt)}`
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
                <th className="p-3">Purchase order</th>
                <th className="p-3">Invoiced</th>
                <th className="p-3">Rate</th>
                <th className="p-3">Tax %</th>
                <th className="p-3">Net</th>
                <th className="p-3">Matched</th>
                <th className="p-3">GRN matches</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {record.lines.map((line) => (
                <tr key={line.id}>
                  <td className="p-3">
                    <strong>{line.itemCode}</strong>
                    <span className="block text-xs">{line.itemName}</span>
                  </td>
                  <td className="p-3">{line.purchaseOrderNumber}</td>
                  <td className="p-3">
                    {line.invoicedQuantity} {line.canonicalUnitSymbol}
                  </td>
                  <td className="p-3">{line.invoicedUnitRate}</td>
                  <td className="p-3">{line.taxPercent}</td>
                  <td className="p-3">{line.netAmount}</td>
                  <td className="p-3">
                    {line.matchedQuantityTotal} / {line.invoicedQuantity}
                    {line.matchedQuantityTotal !== line.invoicedQuantity && (
                      <span className="ml-1 text-xs text-amber-700">incomplete</span>
                    )}
                  </td>
                  <td className="p-3">
                    {line.matches.length === 0 ? (
                      <span className="text-xs text-[var(--muted)]">none yet</span>
                    ) : (
                      <ul className="space-y-1 text-xs">
                        {line.matches.map((match) => (
                          <li key={match.id}>
                            {match.goodsReceiptNumber}: {match.matchedQuantity}
                            {record.status !== "DRAFT" && (
                              <>
                                {" "}
                                (cost {match.grnDerivedUnitCost}, price var{" "}
                                {match.priceVarianceAmount}, tax var {match.taxVarianceAmount})
                              </>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <Card className="mt-5 p-5">
        <h2 className="font-semibold">Notes</h2>
        <p className="mt-2 whitespace-pre-wrap text-sm">{record.notes ?? "-"}</p>
        {record.cancelledAt && (
          <p className="mt-4 text-sm text-red-700">
            Cancelled by {record.cancelledByName}: {record.cancellationReason}
          </p>
        )}
        {record.reversedAt && (
          <p className="mt-4 text-sm text-red-700">
            Reversed by {record.reversedByName} on {formatDateTimeUtc(record.reversedAt)}:{" "}
            {record.reversalReason}
          </p>
        )}
      </Card>
      {canManage && record.status === "DRAFT" && (
        <Card className="mt-5 space-y-4 p-5">
          <PostPurchaseInvoiceForm action={postPurchaseInvoiceAction} id={record.id} />
          <CancelPurchaseInvoiceForm action={cancelPurchaseInvoiceAction} id={record.id} />
        </Card>
      )}
      {canManage && record.status === "POSTED" && (
        <Card className="mt-5 p-5">
          <ReversePurchaseInvoiceForm action={reversePurchaseInvoiceAction} id={record.id} />
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
