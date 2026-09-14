import Link from "next/link";
import { PageHeader } from "@/components/layout/page-header";
import { Card } from "@/components/ui/card";
import { ResponsiveContainer } from "@/components/ui/responsive-container";
import { hasPermission } from "@/modules/access/domain/principal";
import { parsePurchaseDate, parsePurchasePage } from "@/modules/purchasing/application/listing";
import { parsePurchaseInvoiceStatus } from "@/modules/purchasing/application/purchase-invoice-listing";
import { PURCHASE_INVOICE_STATUSES } from "@/modules/purchasing/application/purchase-invoice-contracts";
import { requirePermission } from "@/server/auth/server-guards";
import { PrismaPurchaseInvoiceRepository } from "@/server/purchasing/prisma-purchase-invoice-repository";

type Params = {
  q?: string;
  supplier?: string;
  status?: string;
  from?: string;
  to?: string;
  page?: string;
};
export default async function PurchaseInvoicesPage({
  searchParams,
}: {
  searchParams: Promise<Params>;
}) {
  const principal = await requirePermission("purchasing.view");
  const params = await searchParams;
  const repository = new PrismaPurchaseInvoiceRepository();
  const page = parsePurchasePage(params.page);
  const [result, suppliers] = await Promise.all([
    repository.listPurchaseInvoices({
      page,
      query: params.q?.trim().slice(0, 120) ?? "",
      supplierId: params.supplier || undefined,
      status: parsePurchaseInvoiceStatus(params.status),
      dateFrom: parsePurchaseDate(params.from),
      dateTo: parsePurchaseDate(params.to, true),
    }),
    repository.listInvoiceSuppliers(),
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
        title="Purchase Invoices"
        description="Match supplier invoices to received goods and post only price/tax variance against already-recognized payables."
      />
      {hasPermission(principal, "purchasing.manage") && (
        <div className="mb-4 flex flex-wrap justify-end gap-2">
          <Link
            className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white"
            href="/purchasing/purchase-invoices/new"
          >
            New Purchase Invoice
          </Link>
        </div>
      )}
      <Card className="mb-4 p-4">
        <form className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
          <input
            className="min-h-11 rounded-lg border px-3"
            defaultValue={params.q}
            name="q"
            placeholder="Invoice, supplier, or supplier ref"
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
            {PURCHASE_INVOICE_STATUSES.map((status) => (
              <option key={status} value={status}>
                {status}
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
                <th className="p-4">Invoice</th>
                <th className="p-4">Date</th>
                <th className="p-4">Supplier</th>
                <th className="p-4">Supplier ref</th>
                <th className="p-4">Status</th>
                <th className="p-4">Grand total</th>
                <th className="p-4">Variance</th>
                <th className="p-4">Created by</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {result.records.map((record) => (
                <tr key={record.id}>
                  <td className="p-4">
                    <Link
                      className="font-mono font-semibold text-[var(--accent)]"
                      href={`/purchasing/purchase-invoices/${record.id}`}
                    >
                      {record.number}
                    </Link>
                  </td>
                  <td className="p-4">{record.invoiceDate.toLocaleDateString()}</td>
                  <td className="p-4">{record.supplierName}</td>
                  <td className="p-4">{record.supplierInvoiceNumber}</td>
                  <td className="p-4">{record.status}</td>
                  <td className="p-4">{record.grandTotal}</td>
                  <td className="p-4">
                    {(Number(record.priceVarianceTotal) + Number(record.taxVarianceTotal)).toFixed(
                      2,
                    )}
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
    `/purchasing/purchase-invoices?${new URLSearchParams({ ...filters, page: String(target) })}`;
  return (
    <div className="flex items-center justify-between border-t p-4 text-sm">
      <span>
        {total} invoices - Page {page} of {pageCount}
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
