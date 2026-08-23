import Link from "next/link";
import { PageHeader } from "@/components/layout/page-header";
import { Card } from "@/components/ui/card";
import { ResponsiveContainer } from "@/components/ui/responsive-container";
import { hasPermission } from "@/modules/access/domain/principal";
import { parsePurchaseDate, parsePurchasePage } from "@/modules/purchasing/application/listing";
import { GOODS_RECEIPT_STATUSES } from "@/modules/purchasing/application/receiving-contracts";
import { parseGoodsReceiptStatus } from "@/modules/purchasing/application/receiving-listing";
import { requirePermission } from "@/server/auth/server-guards";
import { PrismaGoodsReceiptRepository } from "@/server/purchasing/prisma-goods-receipt-repository";
type Params = {
  q?: string;
  supplier?: string;
  status?: string;
  from?: string;
  to?: string;
  page?: string;
};
export default async function GoodsReceivingPage({
  searchParams,
}: {
  searchParams: Promise<Params>;
}) {
  const principal = await requirePermission("purchasing.view");
  const params = await searchParams;
  const repository = new PrismaGoodsReceiptRepository();
  const page = parsePurchasePage(params.page);
  const [result, suppliers] = await Promise.all([
    repository.listGoodsReceipts({
      page,
      query: params.q?.trim().slice(0, 120) ?? "",
      supplierId: params.supplier || undefined,
      status: parseGoodsReceiptStatus(params.status),
      dateFrom: parsePurchaseDate(params.from),
      dateTo: parsePurchaseDate(params.to, true),
    }),
    repository.listReceivingSuppliers(),
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
        title="Goods Receiving"
        description="Receive approved purchase orders into quality hold and classify them through purchase QC."
      />
      <div className="mb-4 flex justify-end">
        {hasPermission(principal, "purchasing.manage") && (
          <Link
            className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white"
            href="/purchasing/goods-receiving/new"
          >
            New goods receipt
          </Link>
        )}
      </div>
      <Card className="mb-4 p-4">
        <form className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
          <input
            className="min-h-11 rounded-lg border px-3"
            defaultValue={params.q}
            name="q"
            placeholder="GRN or PO number"
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
            {GOODS_RECEIPT_STATUSES.map((status) => (
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
          <table className="w-full min-w-[70rem] text-left text-sm">
            <thead className="bg-[var(--surface)]">
              <tr>
                <th className="p-4">GRN</th>
                <th className="p-4">Received</th>
                <th className="p-4">PO</th>
                <th className="p-4">Supplier</th>
                <th className="p-4">Warehouse</th>
                <th className="p-4">Status</th>
                <th className="p-4">Received by</th>
                <th className="p-4">QC</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {result.records.map((receipt) => (
                <tr key={receipt.id}>
                  <td className="p-4">
                    <Link
                      className="font-mono font-semibold text-[var(--accent)]"
                      href={`/purchasing/goods-receiving/${receipt.id}`}
                    >
                      {receipt.number}
                    </Link>
                  </td>
                  <td className="p-4">{receipt.receiptDate.toLocaleString()}</td>
                  <td className="p-4">
                    <Link href={`/purchasing/purchase-orders/${receipt.purchaseOrderId}`}>
                      {receipt.purchaseOrderNumber}
                    </Link>
                  </td>
                  <td className="p-4">{receipt.supplierName}</td>
                  <td className="p-4">{receipt.warehouseName}</td>
                  <td className="p-4">{receipt.status.replaceAll("_", " ")}</td>
                  <td className="p-4">{receipt.receivedByName}</td>
                  <td className="p-4">
                    {receipt.status === "QC_COMPLETED"
                      ? `Completed by ${receipt.qcByName}`
                      : receipt.status === "POSTED"
                        ? "Pending"
                        : "-"}
                  </td>
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
    `/purchasing/goods-receiving?${new URLSearchParams({ ...filters, page: String(target) })}`;
  return (
    <div className="flex items-center justify-between border-t p-4 text-sm">
      <span>
        {total} receipts - Page {page} of {pageCount}
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
