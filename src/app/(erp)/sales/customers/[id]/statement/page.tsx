import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { Card } from "@/components/ui/card";
import { ResponsiveContainer } from "@/components/ui/responsive-container";
import { requirePermission } from "@/server/auth/server-guards";
import { PrismaCustomerPaymentRepository } from "@/server/sales/prisma-customer-payment-repository";
type Params = { from?: string; to?: string };
export default async function CustomerStatementPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Params>;
}) {
  await requirePermission("sales.view");
  const filters = await searchParams;
  const statement = await new PrismaCustomerPaymentRepository().getCustomerStatement(
    (await params).id,
    date(filters.from),
    date(filters.to),
  );
  if (!statement) notFound();
  return (
    <ResponsiveContainer>
      <PageHeader
        title={`${statement.customerCode} — Customer Statement`}
        description="Signed receivable-ledger history; positive balances are due from the customer and negative balances are customer credit."
      />
      <Card className="mb-4 p-4">
        <form className="flex flex-wrap gap-3">
          <input
            className="min-h-11 rounded-lg border border-[var(--border)] px-3"
            defaultValue={filters.from}
            name="from"
            type="date"
          />
          <input
            className="min-h-11 rounded-lg border border-[var(--border)] px-3"
            defaultValue={filters.to}
            name="to"
            type="date"
          />
          <button className="rounded-lg bg-[var(--accent)] px-4 text-sm font-semibold text-white">
            Filter
          </button>
          <Link
            className="rounded-lg border px-4 py-3 text-sm"
            href={`/sales/customers/${(await params).id}/statement`}
          >
            Clear
          </Link>
        </form>
      </Card>
      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[50rem] text-left text-sm">
            <thead className="bg-[var(--surface)]">
              <tr>
                <th className="p-3">Date</th>
                <th className="p-3">Reference</th>
                <th className="p-3">Type</th>
                <th className="p-3">Debit</th>
                <th className="p-3">Credit</th>
                <th className="p-3">Running balance</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              <tr>
                <td className="p-3" colSpan={5}>
                  Opening balance
                </td>
                <td className="p-3">{statement.openingBalance}</td>
              </tr>
              {statement.rows.map((row, index) => (
                <tr key={`${row.reference}-${index}`}>
                  <td className="p-3">{row.date.toLocaleDateString()}</td>
                  <td className="p-3">{row.reference}</td>
                  <td className="p-3">{row.type}</td>
                  <td className="p-3">{row.debit}</td>
                  <td className="p-3">{row.credit}</td>
                  <td className="p-3">{row.runningBalance}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="p-4 text-right font-semibold">Closing balance: {statement.closingBalance}</p>
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
