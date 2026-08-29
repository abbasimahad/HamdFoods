import Link from "next/link";
import { PageHeader } from "@/components/layout/page-header";
import { Card } from "@/components/ui/card";
import { ResponsiveContainer } from "@/components/ui/responsive-container";
import { hasPermission } from "@/modules/access/domain/principal";
import {
  parseCustomerPaymentMethod,
  parseCustomerPaymentStatus,
} from "@/modules/sales/application/manage-customer-payments";
import { requirePermission } from "@/server/auth/server-guards";
import { PrismaCustomerPaymentRepository } from "@/server/sales/prisma-customer-payment-repository";
type Params = {
  q?: string;
  customer?: string;
  method?: string;
  status?: string;
  from?: string;
  to?: string;
  page?: string;
};
export default async function CustomerPaymentsPage({
  searchParams,
}: {
  searchParams: Promise<Params>;
}) {
  const principal = await requirePermission("sales.view");
  const params = await searchParams;
  const repository = new PrismaCustomerPaymentRepository();
  const page =
    Number.isSafeInteger(Number(params.page)) && Number(params.page) > 0 ? Number(params.page) : 1;
  const [references, result] = await Promise.all([
    repository.getCustomerPaymentReferences(),
    repository.listCustomerPayments({
      page,
      query: params.q?.trim().slice(0, 120) ?? "",
      customerId: params.customer || undefined,
      method: parseCustomerPaymentMethod(params.method),
      status: parseCustomerPaymentStatus(params.status),
      dateFrom: date(params.from),
      dateTo: date(params.to),
    }),
  ]);
  const preserved = Object.fromEntries(
    Object.entries({
      q: params.q,
      customer: params.customer,
      method: params.method,
      status: params.status,
      from: params.from,
      to: params.to,
    }).filter(([, value]) => value),
  ) as Record<string, string>;
  return (
    <ResponsiveContainer>
      <PageHeader
        title="Customer Payments"
        description="Posted payments reduce receivables; allocated amounts settle invoices and any excess remains customer credit."
      />
      <div className="mb-4 flex justify-end">
        {hasPermission(principal, "sales.manage") && (
          <Link
            className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white"
            href="/sales/payments/new"
          >
            New payment
          </Link>
        )}
      </div>
      <Card className="mb-4 p-4">
        <form className="grid gap-3 md:grid-cols-2 xl:grid-cols-7">
          <input
            className="min-h-11 rounded-lg border border-[var(--border)] px-3"
            defaultValue={params.q}
            name="q"
            placeholder="Receipt, customer, or reference"
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
            defaultValue={params.method ?? ""}
            name="method"
          >
            <option value="">All methods</option>
            {["CASH", "BANK_TRANSFER", "CHEQUE", "CARD", "OTHER"].map((method) => (
              <option key={method}>{method}</option>
            ))}
          </select>
          <select
            className="min-h-11 rounded-lg border border-[var(--border)] bg-white px-3"
            defaultValue={params.status ?? ""}
            name="status"
          >
            <option value="">All statuses</option>
            {["DRAFT", "POSTED", "CANCELLED"].map((status) => (
              <option key={status}>{status}</option>
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
                <th className="p-3">Receipt</th>
                <th className="p-3">Date</th>
                <th className="p-3">Customer</th>
                <th className="p-3">Method</th>
                <th className="p-3">Amount</th>
                <th className="p-3">Allocated</th>
                <th className="p-3">Unallocated</th>
                <th className="p-3">Status</th>
                <th className="p-3">Posted by</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {result.records.map((payment) => (
                <tr key={payment.id}>
                  <td className="p-3">
                    <Link
                      className="font-mono font-semibold text-[var(--accent)]"
                      href={`/sales/payments/${payment.id}`}
                    >
                      {payment.number}
                    </Link>
                  </td>
                  <td className="p-3">{payment.paymentDate.toLocaleDateString()}</td>
                  <td className="p-3">{payment.customerName}</td>
                  <td className="p-3">{payment.method}</td>
                  <td className="p-3">{payment.totalAmount}</td>
                  <td className="p-3">{payment.allocatedAmount}</td>
                  <td className="p-3">{payment.unallocatedAmount}</td>
                  <td className="p-3">{payment.status}</td>
                  <td className="p-3">{payment.postedByName ?? "-"}</td>
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
    `/sales/payments?${new URLSearchParams({ ...params, page: String(target) })}`;
  return (
    <div className="flex items-center justify-between border-t p-4 text-sm">
      <span>
        {total} payments — Page {page} of {pageCount}
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
