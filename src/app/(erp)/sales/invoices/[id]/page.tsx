import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { Card } from "@/components/ui/card";
import { ResponsiveContainer } from "@/components/ui/responsive-container";
import { hasPermission } from "@/modules/access/domain/principal";
import { requirePermission } from "@/server/auth/server-guards";
import { PrismaSalesInvoiceRepository } from "@/server/sales/prisma-sales-invoice-repository";
import { postInvoiceFormAction, cancelInvoiceFormAction } from "../actions";
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const principal = await requirePermission("sales.view");
  const x = await new PrismaSalesInvoiceRepository().getSalesInvoice((await params).id);
  if (!x) notFound();
  const canManage = hasPermission(principal, "sales.manage");
  return (
    <ResponsiveContainer>
      <PageHeader
        title={x.number}
        description={`Invoice ${x.status}; no COGS or General Ledger is created.`}
      />
      <p className="mb-4 flex gap-3">
        <Link className="rounded border px-4 py-2" href={`/sales/invoices/${x.id}/print`}>
          Print invoice
        </Link>
        {canManage && x.status === "DRAFT" && (
          <Link className="rounded border px-4 py-2" href={`/sales/invoices/${x.id}/edit`}>
            Edit draft
          </Link>
        )}
      </p>
      <Card className="mb-4 grid gap-3 p-5 md:grid-cols-2">
        <p>Customer: {x.customerName}</p>
        <p>Sales order: {x.salesOrderNumber}</p>
        <p>Invoice date: {x.invoiceDate.toLocaleDateString()}</p>
        <p>Due date: {x.dueDate.toLocaleDateString()}</p>
        <p>
          Salesperson / area / route:{" "}
          {[x.salespersonName, x.areaName, x.routeName].filter(Boolean).join(" / ")}
        </p>
        <p>Outstanding: {x.outstandingAmount}</p>
        <p>Created by: {x.createdByName}</p>
        <p>
          Posted:{" "}
          {x.postedByName ? `${x.postedByName} on ${x.postedAt?.toLocaleString()}` : "Not posted"}
        </p>
      </Card>
      <Card className="overflow-x-auto">
        <table className="w-full min-w-[60rem] text-sm">
          <thead>
            <tr>
              <th>Product</th>
              <th>Cartons</th>
              <th>Loose</th>
              <th>Pieces</th>
              <th>Carton / piece rate</th>
              <th>Discounts / tax</th>
              <th>Total</th>
              <th>Lots</th>
            </tr>
          </thead>
          <tbody>
            {x.lines.map((l) => (
              <tr className="border-t" key={l.id}>
                <td>
                  {l.itemCode} — {l.itemName}
                  <span className="block text-xs">{l.dispatchNumber}</span>
                </td>
                <td>{l.cartons}</td>
                <td>{l.loosePieces}</td>
                <td>{l.totalPieces}</td>
                <td>
                  {l.cartonRate} / {l.pieceRate}
                </td>
                <td>
                  {l.discount1Percent}% + {l.discount2Percent}% / {l.taxPercent}%
                </td>
                <td>{l.netAmount}</td>
                <td>{l.allocations.map((a) => `${a.lotNumber}: ${a.quantity}`).join(", ")}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="p-4">
          Subtotal {x.subtotal} · Discount {x.discountTotal} · Tax {x.taxTotal} · Grand total{" "}
          {x.grandTotal}
        </p>
      </Card>
      {canManage && x.status === "DRAFT" && (
        <Card className="mt-4 flex gap-3 p-5">
          <form action={postInvoiceFormAction}>
            <input name="id" type="hidden" value={x.id} />
            <button className="rounded bg-[var(--accent)] px-4 py-2 text-white">
              Post invoice
            </button>
          </form>
          <form action={cancelInvoiceFormAction}>
            <input name="id" type="hidden" value={x.id} />
            <input name="reason" placeholder="Reason" required />
            <button className="ml-2 rounded border px-4 py-2">Cancel draft</button>
          </form>
        </Card>
      )}
    </ResponsiveContainer>
  );
}
