import Link from "next/link";
import { PageHeader } from "@/components/layout/page-header";
import { Card } from "@/components/ui/card";
import { ResponsiveContainer } from "@/components/ui/responsive-container";
import { hasPermission } from "@/modules/access/domain/principal";
import { parseSalesOrderStatus } from "@/modules/sales/application/manage-sales-orders";
import { formatSalesMoney } from "@/modules/sales/domain/sales-orders";
import { requirePermission } from "@/server/auth/server-guards";
import { PrismaSalesOrderRepository } from "@/server/sales/prisma-sales-order-repository";
type Params = {
  q?: string;
  customer?: string;
  salesperson?: string;
  status?: string;
  from?: string;
  to?: string;
  page?: string;
};
export default async function SalesOrdersPage({ searchParams }: { searchParams: Promise<Params> }) {
  const principal = await requirePermission("sales.view");
  const params = await searchParams;
  const repository = new PrismaSalesOrderRepository();
  const page =
    Number.isSafeInteger(Number(params.page)) && Number(params.page) > 0 ? Number(params.page) : 1;
  const references = await repository.getSalesOrderReferences();
  const result = await repository.listSalesOrders({
    page,
    query: params.q?.trim().slice(0, 120) ?? "",
    customerId: params.customer || undefined,
    salespersonId: params.salesperson || undefined,
    status: parseSalesOrderStatus(params.status),
    dateFrom: date(params.from),
    dateTo: date(params.to),
  });
  const salespersons = [
    ...new Map(
      references.customers
        .filter((customer) => customer.salespersonId && customer.salespersonName)
        .map((customer) => [customer.salespersonId!, customer.salespersonName!] as const),
    ).entries(),
  ];
  const preserved = Object.fromEntries(
    Object.entries({
      q: params.q,
      customer: params.customer,
      salesperson: params.salesperson,
      status: params.status,
      from: params.from,
      to: params.to,
    }).filter(([, value]) => value),
  ) as Record<string, string>;
  return (
    <ResponsiveContainer>
      <PageHeader
        title="Sales Orders"
        description="Draft commercial commitments; approval reserves AVAILABLE finished-goods stock without dispatch or accounting."
      />
      <div className="mb-4 flex justify-end">
        {hasPermission(principal, "sales.manage") && (
          <Link
            className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white"
            href="/sales/orders/new"
          >
            New sales order
          </Link>
        )}
      </div>
      <Card className="mb-4 p-4">
        <form className="grid gap-3 md:grid-cols-2 xl:grid-cols-7">
          <input
            className="min-h-11 rounded-lg border border-[var(--border)] px-3"
            defaultValue={params.q}
            name="q"
            placeholder="SO number"
          />
          <select
            className="min-h-11 rounded-lg border border-[var(--border)] bg-white px-3"
            defaultValue={params.customer ?? ""}
            name="customer"
          >
            <option value="">All customers</option>
            {references.customers.map((customer) => (
              <option key={customer.id} value={customer.id}>
                {customer.code} - {customer.name}
              </option>
            ))}
          </select>
          <select
            className="min-h-11 rounded-lg border border-[var(--border)] bg-white px-3"
            defaultValue={params.salesperson ?? ""}
            name="salesperson"
          >
            <option value="">All salespersons</option>
            {salespersons.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
          <select
            className="min-h-11 rounded-lg border border-[var(--border)] bg-white px-3"
            defaultValue={params.status ?? ""}
            name="status"
          >
            <option value="">All statuses</option>
            {["DRAFT", "APPROVED", "CANCELLED"].map((status) => (
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
          <button className="rounded-lg bg-[var(--accent)] px-4 font-semibold text-white">
            Filter
          </button>
        </form>
      </Card>
      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[75rem] text-left text-sm">
            <thead className="bg-[var(--surface)]">
              <tr>
                <th className="p-4">SO number</th>
                <th className="p-4">Date</th>
                <th className="p-4">Customer</th>
                <th className="p-4">Salesperson</th>
                <th className="p-4">Area</th>
                <th className="p-4">Warehouse</th>
                <th className="p-4">Status</th>
                <th className="p-4">Total</th>
                <th className="p-4">Delivery</th>
                <th className="p-4">Created by</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {result.records.map((order) => (
                <tr key={order.id}>
                  <td className="p-4">
                    <Link
                      className="font-mono font-semibold text-[var(--accent)]"
                      href={`/sales/orders/${order.id}`}
                    >
                      {order.number}
                    </Link>
                  </td>
                  <td className="p-4">{order.orderDate.toLocaleDateString()}</td>
                  <td className="p-4">{order.customerName}</td>
                  <td className="p-4">{order.salespersonName ?? "-"}</td>
                  <td className="p-4">{order.areaName}</td>
                  <td className="p-4">{order.warehouseName}</td>
                  <td className="p-4">{order.status}</td>
                  <td className="p-4 font-semibold">{formatSalesMoney(order.grandTotal)}</td>
                  <td className="p-4">{order.deliveryDate?.toLocaleDateString() ?? "-"}</td>
                  <td className="p-4">{order.createdByName}</td>
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
  const result = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(result.valueOf()) ? undefined : result;
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
    `/sales/orders?${new URLSearchParams({ ...params, page: String(target) })}`;
  return (
    <div className="flex items-center justify-between border-t p-4 text-sm">
      <span>
        {total} orders - Page {page} of {pageCount}
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
