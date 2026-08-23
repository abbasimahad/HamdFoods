import Link from "next/link";
import { PageHeader } from "@/components/layout/page-header";
import { Card } from "@/components/ui/card";
import { ResponsiveContainer } from "@/components/ui/responsive-container";
import { hasPermission } from "@/modules/access/domain/principal";
import {
  parsePurchaseDate,
  parsePurchaseOrderStatus,
  parsePurchasePage,
} from "@/modules/purchasing/application/listing";
import { formatMoney, PURCHASE_ORDER_STATUSES } from "@/modules/purchasing/domain/purchasing";
import { requirePermission } from "@/server/auth/server-guards";
import { PrismaPurchasingRepository } from "@/server/purchasing/prisma-purchasing-repository";

type Params = {
  q?: string;
  supplier?: string;
  status?: string;
  from?: string;
  to?: string;
  page?: string;
};
export default async function PurchaseOrdersPage({
  searchParams,
}: {
  searchParams: Promise<Params>;
}) {
  const principal = await requirePermission("purchasing.view");
  const params = await searchParams;
  const page = parsePurchasePage(params.page);
  const repository = new PrismaPurchasingRepository();
  const [result, suppliers] = await Promise.all([
    repository.listPurchaseOrders({
      page,
      query: params.q?.trim().slice(0, 120) ?? "",
      supplierId: params.supplier || undefined,
      status: parsePurchaseOrderStatus(params.status),
      dateFrom: parsePurchaseDate(params.from),
      dateTo: parsePurchaseDate(params.to, true),
    }),
    repository.listActiveSuppliers(),
  ]);
  const filterParams = {
    ...(params.q ? { q: params.q } : {}),
    ...(params.supplier ? { supplier: params.supplier } : {}),
    ...(params.status ? { status: params.status } : {}),
    ...(params.from ? { from: params.from } : {}),
    ...(params.to ? { to: params.to } : {}),
  };
  return (
    <ResponsiveContainer>
      <PageHeader
        title="Purchase Orders"
        description="Draft, approve, cancel, inspect, and print purchasing commitments without changing stock."
      />
      <div className="mb-4 flex justify-end">
        {hasPermission(principal, "purchasing.manage") && (
          <Link
            className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white"
            href="/purchasing/purchase-orders/new"
          >
            New purchase order
          </Link>
        )}
      </div>
      <Card className="mb-4 p-4">
        <form className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
          <input
            className="min-h-11 rounded-lg border border-[var(--border)] px-3"
            defaultValue={params.q}
            name="q"
            placeholder="PO number"
          />
          <select
            className="min-h-11 rounded-lg border border-[var(--border)] bg-white px-3"
            defaultValue={params.supplier ?? ""}
            name="supplier"
          >
            <option value="">All suppliers</option>
            {suppliers.map((supplier) => (
              <option key={supplier.id} value={supplier.id}>
                {supplier.code} - {supplier.name}
              </option>
            ))}
          </select>
          <select
            className="min-h-11 rounded-lg border border-[var(--border)] bg-white px-3"
            defaultValue={params.status ?? ""}
            name="status"
          >
            <option value="">All statuses</option>
            {PURCHASE_ORDER_STATUSES.map((status) => (
              <option key={status} value={status}>
                {status.replaceAll("_", " ")}
              </option>
            ))}
          </select>
          <input
            aria-label="Order date from"
            className="min-h-11 rounded-lg border border-[var(--border)] px-3"
            defaultValue={params.from}
            name="from"
            type="date"
          />
          <input
            aria-label="Order date to"
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
                <th className="p-4">PO number</th>
                <th className="p-4">Date</th>
                <th className="p-4">Supplier</th>
                <th className="p-4">Expected</th>
                <th className="p-4">Status</th>
                <th className="p-4">Total</th>
                <th className="p-4">Created by</th>
                <th className="p-4">Approval</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {result.records.map((order) => (
                <tr key={order.id}>
                  <td className="p-4">
                    <Link
                      className="font-mono font-semibold text-[var(--accent)]"
                      href={`/purchasing/purchase-orders/${order.id}`}
                    >
                      {order.number}
                    </Link>
                  </td>
                  <td className="p-4">{order.orderDate.toLocaleDateString()}</td>
                  <td className="p-4">{order.supplierName}</td>
                  <td className="p-4">{order.expectedDeliveryDate?.toLocaleDateString() ?? "-"}</td>
                  <td className="p-4">{order.status.replaceAll("_", " ")}</td>
                  <td className="p-4 font-semibold">{formatMoney(order.grandTotal)}</td>
                  <td className="p-4">{order.createdByName}</td>
                  <td className="p-4">{order.approvedByName ?? "Pending"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Pagination
          page={result.page}
          pageCount={result.pageCount}
          total={result.total}
          params={filterParams}
        />
      </Card>
    </ResponsiveContainer>
  );
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
    `/purchasing/purchase-orders?${new URLSearchParams({ ...params, page: String(target) })}`;
  return (
    <div className="flex items-center justify-between border-t border-[var(--border)] p-4 text-sm">
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
