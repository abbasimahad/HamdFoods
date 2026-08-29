import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { Card } from "@/components/ui/card";
import { ResponsiveContainer } from "@/components/ui/responsive-container";
import { SalesReturnAction } from "@/components/sales/sales-return-actions";
import { hasPermission } from "@/modules/access/domain/principal";
import { requirePermission } from "@/server/auth/server-guards";
import { PrismaSalesReturnRepository } from "@/server/sales/prisma-sales-return-repository";
import {
  cancelSalesReturnAction,
  completeSalesReturnAction,
  receiveSalesReturnAction,
} from "../actions";
export default async function SalesReturnDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const principal = await requirePermission("sales.view");
  const salesReturn = await new PrismaSalesReturnRepository().getSalesReturn((await params).id);
  if (!salesReturn) notFound();
  const manage = hasPermission(principal, "sales.manage");
  return (
    <ResponsiveContainer>
      <PageHeader
        title={salesReturn.number}
        description={`${salesReturn.type} · ${salesReturn.status}`}
      />
      <div className="mb-4 flex flex-wrap gap-2">
        <Link
          className="rounded border px-3 py-2 text-sm"
          href={`/sales/returns/${salesReturn.id}/print`}
        >
          Print return note
        </Link>
        {manage && salesReturn.status === "DRAFT" && (
          <>
            <SalesReturnAction
              action={receiveSalesReturnAction}
              id={salesReturn.id}
              label="Receive into inspection"
            />
            <SalesReturnAction
              action={cancelSalesReturnAction}
              id={salesReturn.id}
              label="Cancel draft"
              needsReason
            />
          </>
        )}
        {manage && salesReturn.status === "RECEIVED" && (
          <Link
            className="rounded border border-[var(--accent)] px-3 py-2 text-sm font-semibold text-[var(--accent)]"
            href={`/sales/returns/${salesReturn.id}/inspection`}
          >
            Inspect return
          </Link>
        )}
        {manage && salesReturn.status === "INSPECTED" && (
          <SalesReturnAction
            action={completeSalesReturnAction}
            id={salesReturn.id}
            label="Post customer credit"
          />
        )}
      </div>
      <Card className="mb-4 p-5">
        <div className="grid gap-3 text-sm md:grid-cols-3">
          <p>
            <strong>Customer:</strong> {salesReturn.customerCode} — {salesReturn.customerName}
          </p>
          <p>
            <strong>Invoice:</strong>{" "}
            {salesReturn.salesInvoiceNumber ?? "No invoice — physical refusal"}
          </p>
          <p>
            <strong>Dispatch:</strong> {salesReturn.salesDispatchNumber}
          </p>
          <p>
            <strong>Warehouse:</strong> {salesReturn.receivingWarehouseName}
          </p>
          <p>
            <strong>Date:</strong> {salesReturn.returnAt.toLocaleDateString()}
          </p>
          <p>
            <strong>Created by:</strong> {salesReturn.createdByName}
          </p>
        </div>
      </Card>
      <Card className="mb-4 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[65rem] text-left text-sm">
            <thead className="bg-[var(--surface)]">
              <tr>
                <th className="p-3">Product / lot</th>
                <th className="p-3">Cartons / loose</th>
                <th className="p-3">Pieces</th>
                <th className="p-3">Return reason</th>
                <th className="p-3">Inspection</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {salesReturn.lines.map((line) => (
                <tr key={line.id}>
                  <td className="p-3">
                    <strong>{line.itemCode}</strong>
                    <span className="block text-xs">
                      {line.itemName} · Lot {line.lotNumber}
                    </span>
                  </td>
                  <td className="p-3">
                    {line.cartons} / {line.loosePieces}
                  </td>
                  <td className="p-3">{line.totalPieces}</td>
                  <td className="p-3">{line.reason}</td>
                  <td className="p-3">
                    {line.inspections.length
                      ? line.inspections
                          .map(
                            (inspection) => `${inspection.classification}: ${inspection.quantity}`,
                          )
                          .join(", ")
                      : "Pending"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <Card className="p-5 text-sm">
        <h2 className="mb-2 font-semibold">Financial effect</h2>
        {salesReturn.type === "INVOICED_RETURN" ? (
          <div className="grid gap-2 md:grid-cols-4">
            <p>Gross: {salesReturn.grossAmount}</p>
            <p>Discount reversal: {salesReturn.discountAmount}</p>
            <p>Tax reversal: {salesReturn.taxAmount}</p>
            <p>Customer credit: {salesReturn.creditAmount}</p>
          </div>
        ) : (
          <p>No financial credit — goods were not invoiced.</p>
        )}
      </Card>
    </ResponsiveContainer>
  );
}
