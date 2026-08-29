import Link from "next/link";
import { PageHeader } from "@/components/layout/page-header";
import { Card } from "@/components/ui/card";
import { ResponsiveContainer } from "@/components/ui/responsive-container";
import { hasPermission } from "@/modules/access/domain/principal";
import { parseSalesInvoiceStatus } from "@/modules/sales/application/manage-sales-invoices";
import { requirePermission } from "@/server/auth/server-guards";
import { PrismaSalesInvoiceRepository } from "@/server/sales/prisma-sales-invoice-repository";

type Params = {
  q?: string;
  customer?: string;
  salesOrder?: string;
  status?: string;
  from?: string;
  to?: string;
  page?: string;
};
export default async function SalesInvoicesPage({
  searchParams,
}: {
  searchParams: Promise<Params>;
}) {
  const principal = await requirePermission("sales.view");
  const params = await searchParams;
  const repository = new PrismaSalesInvoiceRepository();
  const page =
    Number.isSafeInteger(Number(params.page)) && Number(params.page) > 0 ? Number(params.page) : 1;
  const [references, result] = await Promise.all([
    repository.getSalesInvoiceListReferences(),
    repository.listSalesInvoices({
      page,
      query: params.q?.trim().slice(0, 120) ?? "",
      customerId: params.customer || undefined,
      salesOrderId: params.salesOrder || undefined,
      status: parseSalesInvoiceStatus(params.status),
      dateFrom: date(params.from),
      dateTo: date(params.to),
    }),
  ]);
  const preserved = Object.fromEntries(
    Object.entries({
      q: params.q,
      customer: params.customer,
      salesOrder: params.salesOrder,
      status: params.status,
      from: params.from,
      to: params.to,
    }).filter(([, value]) => value),
  ) as Record<string, string>;
  return (
    <ResponsiveContainer>
      <PageHeader
        title="Sales Invoices"
        description="Posted invoices finalize IN TRANSIT stock and create customer receivables."
      />
      <div className="mb-4 flex justify-end">
        {hasPermission(principal, "sales.manage") && (
          <Link
            className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white"
            href="/sales/invoices/new"
          >
            New invoice
          </Link>
        )}
      </div>
      <Card className="mb-4 p-4">
        <form className="grid gap-3 md:grid-cols-2 xl:grid-cols-7">
          <input
            className="min-h-11 rounded-lg border border-[var(--border)] px-3"
            defaultValue={params.q}
            name="q"
            placeholder="Invoice, customer, or SO"
          />
          <select
            className="min-h-11 rounded-lg border border-[var(--border)] bg-white px-3"
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
            className="min-h-11 rounded-lg border border-[var(--border)] bg-white px-3"
            defaultValue={params.salesOrder ?? ""}
            name="salesOrder"
          >
            <option value="">All Sales Orders</option>
            {references.orders.map((order) => (
              <option key={order.id} value={order.id}>
                {order.number}
              </option>
            ))}
          </select>
          <select
            className="min-h-11 rounded-lg border border-[var(--border)] bg-white px-3"
            defaultValue={params.status ?? ""}
            name="status"
          >
            <option value="">All statuses</option>
            {["DRAFT", "POSTED", "CANCELLED"].map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
          </select>
          <input
            className="min-h-11 rounded-lg border border-[var(--border)] px-3"
            defaultValue={params.from}
            name="from"
            type="date"
          />
          <input
            className="min-h-11 rounded-lg border border-[var(--border)] px-3"
            defaultValue={params.to}
            name="to"
            type="date"
          />
          <button className="rounded-lg bg-[var(--accent)] px-4 text-sm font-semibold text-white">
            Filter
          </button>
        </form>
      </Card>
      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[70rem] text-left text-sm">
            <thead className="bg-[var(--surface)]">
              <tr>
                <th className="p-3">Invoice</th>
                <th className="p-3">Date</th>
                <th className="p-3">Customer</th>
                <th className="p-3">Sales Order</th>
                <th className="p-3">Grand total</th>
                <th className="p-3">Due</th>
                <th className="p-3">Status</th>
                <th className="p-3">Outstanding</th>
                <th className="p-3">Posted by</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {result.records.map((invoice) => (
                <tr key={invoice.id}>
                  <td className="p-3">
                    <Link
                      className="font-mono font-semibold text-[var(--accent)]"
                      href={`/sales/invoices/${invoice.id}`}
                    >
                      {invoice.number}
                    </Link>
                  </td>
                  <td className="p-3">{invoice.invoiceDate.toLocaleDateString()}</td>
                  <td className="p-3">{invoice.customerName}</td>
                  <td className="p-3">{invoice.salesOrderNumber}</td>
                  <td className="p-3">{invoice.grandTotal}</td>
                  <td className="p-3">{invoice.dueDate.toLocaleDateString()}</td>
                  <td className="p-3">{invoice.status}</td>
                  <td className="p-3">{invoice.outstandingAmount}</td>
                  <td className="p-3">{invoice.postedByName ?? "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Pagination
          page={result.page}
          pageCount={result.pageCount}
          total={result.total}
          params={preserved}
        />
      </Card>
    </ResponsiveContainer>
  );
}
function date(value?: string) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== value
    ? undefined
    : parsed;
}
function Pagination({
  page,
  pageCount,
  total,
  params,
}: {
  page: number;
  pageCount: number;
  total: number;
  params: Record<string, string>;
}) {
  const href = (target: number) =>
    `/sales/invoices?${new URLSearchParams({ ...params, page: String(target) })}`;
  return (
    <div className="flex items-center justify-between border-t p-4 text-sm">
      <span>
        {total} invoices — Page {page} of {pageCount}
      </span>
      <div className="flex gap-2">
        {page > 1 && (
          <Link className="rounded-lg border px-3 py-2" href={href(page - 1)}>
            Previous
          </Link>
        )}
        {page < pageCount && (
          <Link className="rounded-lg border px-3 py-2" href={href(page + 1)}>
            Next
          </Link>
        )}
      </div>
    </div>
  );
}
