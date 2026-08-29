import Link from "next/link";
import { PageHeader } from "@/components/layout/page-header";
import { Card } from "@/components/ui/card";
import { ResponsiveContainer } from "@/components/ui/responsive-container";
import { hasPermission } from "@/modules/access/domain/principal";
import { parseSalesDispatchStatus } from "@/modules/sales/application/manage-sales-dispatches";
import { requirePermission } from "@/server/auth/server-guards";
import { PrismaSalesDispatchRepository } from "@/server/sales/prisma-sales-dispatch-repository";
type Params = { q?: string; status?: string; from?: string; to?: string; page?: string };
export default async function SalesDispatchesPage({
  searchParams,
}: {
  searchParams: Promise<Params>;
}) {
  const principal = await requirePermission("sales.view");
  const params = await searchParams;
  const repository = new PrismaSalesDispatchRepository();
  const page =
    Number.isSafeInteger(Number(params.page)) && Number(params.page) > 0 ? Number(params.page) : 1;
  const result = await repository.listSalesDispatches({
    page,
    query: params.q?.trim().slice(0, 120) ?? "",
    status: parseSalesDispatchStatus(params.status),
    dateFrom: date(params.from),
    dateTo: date(params.to),
  });
  const preserved = Object.fromEntries(
    Object.entries({ q: params.q, status: params.status, from: params.from, to: params.to }).filter(
      ([, value]) => value,
    ),
  ) as Record<string, string>;
  return (
    <ResponsiveContainer>
      <PageHeader
        title="Dispatches"
        description="Delivery notes allocate approved-order reservations to finished-good lots and move them from RESERVED to IN TRANSIT."
      />
      <div className="mb-4 flex justify-end">
        {hasPermission(principal, "sales.manage") && (
          <Link
            className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white"
            href="/sales/dispatches/new"
          >
            New dispatch
          </Link>
        )}
      </div>
      <Card className="mb-4 p-4">
        <form className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          <input
            className="min-h-11 rounded-lg border border-[var(--border)] px-3"
            defaultValue={params.q}
            name="q"
            placeholder="Dispatch, order, or customer"
          />
          <select
            className="min-h-11 rounded-lg border border-[var(--border)] bg-white px-3"
            defaultValue={params.status ?? ""}
            name="status"
          >
            <option value="">All statuses</option>
            {["DRAFT", "POSTED", "DELIVERED", "CANCELLED"].map((status) => (
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
          <table className="w-full min-w-[70rem] text-left text-sm">
            <thead className="bg-[var(--surface)]">
              <tr>
                <th className="p-4">Dispatch</th>
                <th className="p-4">Date</th>
                <th className="p-4">Sales Order</th>
                <th className="p-4">Customer</th>
                <th className="p-4">Warehouse</th>
                <th className="p-4">Status</th>
                <th className="p-4">Vehicle</th>
                <th className="p-4">Salesperson</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {result.records.map((dispatch) => (
                <tr key={dispatch.id}>
                  <td className="p-4">
                    <Link
                      className="font-mono font-semibold text-[var(--accent)]"
                      href={`/sales/dispatches/${dispatch.id}`}
                    >
                      {dispatch.number}
                    </Link>
                  </td>
                  <td className="p-4">{dispatch.dispatchAt.toLocaleDateString()}</td>
                  <td className="p-4">
                    <Link
                      className="text-[var(--accent)]"
                      href={`/sales/orders/${dispatch.salesOrderId}`}
                    >
                      {dispatch.salesOrderNumber}
                    </Link>
                  </td>
                  <td className="p-4">{dispatch.customerName}</td>
                  <td className="p-4">{dispatch.warehouseName}</td>
                  <td className="p-4">{dispatch.status}</td>
                  <td className="p-4">{dispatch.vehicleNumber ?? "-"}</td>
                  <td className="p-4">{dispatch.salespersonName ?? "-"}</td>
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
    `/sales/dispatches?${new URLSearchParams({ ...params, page: String(target) })}`;
  return (
    <div className="flex items-center justify-between border-t p-4 text-sm">
      <span>
        {total} dispatches — Page {page} of {pageCount}
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
