import Link from "next/link";
import { PageHeader } from "@/components/layout/page-header";
import { Card } from "@/components/ui/card";
import { ResponsiveContainer } from "@/components/ui/responsive-container";
import { hasPermission } from "@/modules/access/domain/principal";
import {
  parseSalesReturnStatus,
  parseSalesReturnType,
} from "@/modules/sales/application/manage-sales-returns";
import { requirePermission } from "@/server/auth/server-guards";
import { PrismaSalesReturnRepository } from "@/server/sales/prisma-sales-return-repository";
type Params = {
  q?: string;
  customer?: string;
  invoice?: string;
  status?: string;
  type?: string;
  from?: string;
  to?: string;
  page?: string;
};
export default async function SalesReturnsPage({
  searchParams,
}: {
  searchParams: Promise<Params>;
}) {
  const principal = await requirePermission("sales.view");
  const params = await searchParams;
  const page = Math.max(1, Number(params.page) || 1);
  const repository = new PrismaSalesReturnRepository();
  const [references, result] = await Promise.all([
    repository.getSalesReturnReferences(),
    repository.listSalesReturns({
      page,
      query: params.q?.trim().slice(0, 120) ?? "",
      customerId: params.customer || undefined,
      salesInvoiceId: params.invoice || undefined,
      status: parseSalesReturnStatus(params.status),
      type: parseSalesReturnType(params.type),
      dateFrom: parseDate(params.from),
      dateTo: parseDate(params.to),
    }),
  ]);
  return (
    <ResponsiveContainer>
      <PageHeader
        title="Sales Returns"
        description="All customer returns enter RETURN_INSPECTION before resale, quarantine, reprocess, damaged, or expired routing."
      />
      <div className="mb-4 flex justify-end">
        {hasPermission(principal, "sales.manage") && (
          <Link
            className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white"
            href="/sales/returns/new"
          >
            New return
          </Link>
        )}
      </div>
      <Card className="mb-4 p-4">
        <form className="grid gap-3 md:grid-cols-4 xl:grid-cols-7">
          <input
            className="min-h-11 rounded border p-3"
            defaultValue={params.q}
            name="q"
            placeholder="Return, customer, invoice, or dispatch"
          />
          <select
            className="min-h-11 rounded border bg-white p-3"
            defaultValue={params.customer ?? ""}
            name="customer"
          >
            <option value="">All customers</option>
            {references.customers.map((customer) => (
              <option key={customer.id} value={customer.id}>
                {customer.code} — {customer.name}
              </option>
            ))}
          </select>
          <select
            className="min-h-11 rounded border bg-white p-3"
            defaultValue={params.invoice ?? ""}
            name="invoice"
          >
            <option value="">All invoices</option>
            {references.invoices.map((invoice) => (
              <option key={invoice.id} value={invoice.id}>
                {invoice.number}
              </option>
            ))}
          </select>
          <select
            className="min-h-11 rounded border bg-white p-3"
            defaultValue={params.type ?? ""}
            name="type"
          >
            <option value="">All types</option>
            <option value="INVOICED_RETURN">Invoiced return</option>
            <option value="DISPATCH_REFUSAL">Dispatch refusal</option>
          </select>
          <input
            className="min-h-11 rounded border p-3"
            defaultValue={params.from}
            name="from"
            type="date"
          />
          <input
            className="min-h-11 rounded border p-3"
            defaultValue={params.to}
            name="to"
            type="date"
          />
          <select
            className="min-h-11 rounded border bg-white p-3"
            defaultValue={params.status ?? ""}
            name="status"
          >
            <option value="">All statuses</option>
            {["DRAFT", "RECEIVED", "INSPECTED", "COMPLETED", "CANCELLED"].map((status) => (
              <option key={status}>{status}</option>
            ))}
          </select>
          <button className="rounded bg-[var(--accent)] px-4 text-sm font-semibold text-white">
            Filter
          </button>
        </form>
      </Card>
      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[65rem] text-left text-sm">
            <thead className="bg-[var(--surface)]">
              <tr>
                <th className="p-3">Return</th>
                <th className="p-3">Date</th>
                <th className="p-3">Customer</th>
                <th className="p-3">Invoice / dispatch</th>
                <th className="p-3">Type</th>
                <th className="p-3">Status</th>
                <th className="p-3">Credit</th>
                <th className="p-3">Received by</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {result.records.map((salesReturn) => (
                <tr key={salesReturn.id}>
                  <td className="p-3">
                    <Link
                      className="font-mono font-semibold text-[var(--accent)]"
                      href={`/sales/returns/${salesReturn.id}`}
                    >
                      {salesReturn.number}
                    </Link>
                  </td>
                  <td className="p-3">{salesReturn.returnAt.toLocaleDateString()}</td>
                  <td className="p-3">{salesReturn.customerName}</td>
                  <td className="p-3">
                    {salesReturn.salesInvoiceNumber ?? "No invoice"} /{" "}
                    {salesReturn.salesDispatchNumber}
                  </td>
                  <td className="p-3">{salesReturn.type}</td>
                  <td className="p-3">{salesReturn.status}</td>
                  <td className="p-3">
                    {salesReturn.type === "INVOICED_RETURN" ? salesReturn.creditAmount : "—"}
                  </td>
                  <td className="p-3">{salesReturn.receivedByName ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-between border-t p-4 text-sm">
          <span>
            {result.total} returns — Page {result.page} of {result.pageCount}
          </span>
          <div className="flex gap-2">
            {result.page > 1 && (
              <Link
                className="rounded border px-3 py-2"
                href={`/sales/returns?page=${result.page - 1}`}
              >
                Previous
              </Link>
            )}
            {result.page < result.pageCount && (
              <Link
                className="rounded border px-3 py-2"
                href={`/sales/returns?page=${result.page + 1}`}
              >
                Next
              </Link>
            )}
          </div>
        </div>
      </Card>
    </ResponsiveContainer>
  );
}

function parseDate(value?: string) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const result = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(result.valueOf()) || result.toISOString().slice(0, 10) !== value
    ? undefined
    : result;
}
