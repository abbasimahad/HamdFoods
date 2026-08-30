import { notFound } from "next/navigation";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/layout/page-header";
import { ResponsiveContainer } from "@/components/ui/responsive-container";
import { requirePermission } from "@/server/auth/server-guards";
import { supplierStatement } from "@/server/accounting/prisma-phase23-repository";
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  await requirePermission("accounting.view");
  const [id, query] = [(await params).id, await searchParams];
  const report = await supplierStatement(id, date(query.from), date(query.to));
  if (!report) notFound();
  return (
    <ResponsiveContainer>
      <PageHeader
        title={`${report.supplier.code} — Supplier Statement`}
        description="Positive balance is payable; a negative balance is a supplier advance/debit position."
      />
      <Card className="mb-4 p-4">
        <form className="flex gap-2">
          <input
            className="rounded border px-3 py-2"
            defaultValue={query.from}
            name="from"
            type="date"
          />
          <input
            className="rounded border px-3 py-2"
            defaultValue={query.to}
            name="to"
            type="date"
          />
          <button className="rounded bg-[var(--accent)] px-3 py-2 text-white">Apply</button>
        </form>
        <p className="mt-3 text-sm">
          Opening: {report.openingBalance}; Closing: {report.closingBalance}
        </p>
        <div className="mt-3 grid gap-2 text-sm md:grid-cols-4">
          <p>0–30 days: {report.aging.current}</p>
          <p>31–60 days: {report.aging.days31To60}</p>
          <p>61–90 days: {report.aging.days61To90}</p>
          <p>Over 90 days: {report.aging.over90}</p>
        </div>
      </Card>
      <Card className="overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr>
              <th className="p-3 text-left">Date</th>
              <th className="p-3 text-left">Reference</th>
              <th className="p-3 text-left">Type</th>
              <th className="p-3 text-left">Debit</th>
              <th className="p-3 text-left">Credit</th>
              <th className="p-3 text-left">Balance</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {report.rows.map((row) => (
              <tr key={row.id}>
                <td className="p-3">{row.entryDate.toISOString().slice(0, 10)}</td>
                <td className="p-3">{row.sourceNumber ?? row.sourceId}</td>
                <td className="p-3">{row.entryType}</td>
                <td className="p-3">{row.debit}</td>
                <td className="p-3">{row.credit}</td>
                <td className="p-3">{row.runningBalance}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </ResponsiveContainer>
  );
}
function date(value?: string) {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? new Date(`${value}T00:00:00.000Z`)
    : undefined;
}
