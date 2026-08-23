import Link from "next/link";
import { PageHeader } from "@/components/layout/page-header";
import { Card } from "@/components/ui/card";
import { ResponsiveContainer } from "@/components/ui/responsive-container";
import { hasPermission } from "@/modules/access/domain/principal";
import { parsePurchaseDate, parsePurchasePage } from "@/modules/purchasing/application/listing";
import { parsePurchaseReturnStatus } from "@/modules/purchasing/application/return-listing";
import { PURCHASE_RETURN_STATUSES } from "@/modules/purchasing/application/return-contracts";
import { requirePermission } from "@/server/auth/server-guards";
import { PrismaPurchaseReturnRepository } from "@/server/purchasing/prisma-purchase-return-repository";

type Params = {
  q?: string;
  supplier?: string;
  status?: string;
  from?: string;
  to?: string;
  page?: string;
};
export default async function PurchaseReturnsPage({
  searchParams,
}: {
  searchParams: Promise<Params>;
}) {
  const principal = await requirePermission("purchasing.view");
  const params = await searchParams;
  const repository = new PrismaPurchaseReturnRepository();
  const page = parsePurchasePage(params.page);
  const [result, suppliers] = await Promise.all([
    repository.listPurchaseReturns({
      page,
      query: params.q?.trim().slice(0, 120) ?? "",
      supplierId: params.supplier || undefined,
      status: parsePurchaseReturnStatus(params.status),
      dateFrom: parsePurchaseDate(params.from),
      dateTo: parsePurchaseDate(params.to, true),
    }),
    repository.listReturnSuppliers(),
  ]);
  const filters = {
    ...(params.q ? { q: params.q } : {}),
    ...(params.supplier ? { supplier: params.supplier } : {}),
    ...(params.status ? { status: params.status } : {}),
    ...(params.from ? { from: params.from } : {}),
    ...(params.to ? { to: params.to } : {}),
  };
  return (
    <ResponsiveContainer>
      <PageHeader
        title="Purchase Returns"
        description="Return purchased quarantine stock to suppliers and track free replacement obligations."
      />
      {hasPermission(principal, "purchasing.manage") && (
        <div className="mb-4 flex flex-wrap justify-end gap-2">
          <Link
            className="rounded-lg border px-4 py-2 text-sm font-semibold"
            href="/purchasing/purchase-returns/quarantine"
          >
            Send accepted lot to quarantine
          </Link>
          <Link
            className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white"
            href="/purchasing/purchase-returns/new"
          >
            New purchase return
          </Link>
        </div>
      )}
      <Card className="mb-4 p-4">
        <form className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
          <input
            className="min-h-11 rounded-lg border px-3"
            defaultValue={params.q}
            name="q"
            placeholder="Return, supplier, or PO"
          />
          <select
            className="min-h-11 rounded-lg border bg-white px-3"
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
            className="min-h-11 rounded-lg border bg-white px-3"
            defaultValue={params.status ?? ""}
            name="status"
          >
            <option value="">All statuses</option>
            {PURCHASE_RETURN_STATUSES.map((status) => (
              <option key={status} value={status}>
                {status.replaceAll("_", " ")}
              </option>
            ))}
          </select>
          <input
            className="min-h-11 rounded-lg border px-3"
            defaultValue={params.from}
            name="from"
            type="date"
          />
          <input
            className="min-h-11 rounded-lg border px-3"
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
                <th className="p-4">Return</th>
                <th className="p-4">Date</th>
                <th className="p-4">Supplier</th>
                <th className="p-4">PO / GRN</th>
                <th className="p-4">Status</th>
                <th className="p-4">Returned</th>
                <th className="p-4">Replacement remaining</th>
                <th className="p-4">Created by</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {result.records.map((record) => (
                <tr key={record.id}>
                  <td className="p-4">
                    <Link
                      className="font-mono font-semibold text-[var(--accent)]"
                      href={`/purchasing/purchase-returns/${record.id}`}
                    >
                      {record.number}
                    </Link>
                  </td>
                  <td className="p-4">{record.returnDate.toLocaleDateString()}</td>
                  <td className="p-4">{record.supplierName}</td>
                  <td className="p-4">
                    {record.purchaseOrderNumber} / {record.originalGoodsReceiptNumber}
                  </td>
                  <td className="p-4">{record.status.replaceAll("_", " ")}</td>
                  <td className="p-4">{record.lines.length} line(s)</td>
                  <td className="p-4">
                    {record.lines.map((line) => line.replacementRemainingQuantity).join(" + ")}
                  </td>
                  <td className="p-4">{record.createdByName}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Pagination
          page={result.page}
          pageCount={result.pageCount}
          total={result.total}
          filters={filters}
        />
      </Card>
    </ResponsiveContainer>
  );
}
function Pagination({
  page,
  pageCount,
  total,
  filters,
}: {
  page: number;
  pageCount: number;
  total: number;
  filters: Record<string, string>;
}) {
  const href = (target: number) =>
    `/purchasing/purchase-returns?${new URLSearchParams({ ...filters, page: String(target) })}`;
  return (
    <div className="flex items-center justify-between border-t p-4 text-sm">
      <span>
        {total} returns - Page {page} of {pageCount}
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
