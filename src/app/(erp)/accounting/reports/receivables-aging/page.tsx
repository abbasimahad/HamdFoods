import { FinancialReportControls } from "@/components/accounting/financial-report-controls";
import { PageHeader } from "@/components/layout/page-header";
import { ResponsiveContainer } from "@/components/ui/responsive-container";
import { Card } from "@/components/ui/card";
import { receivableAging, reportAsOf } from "@/server/accounting/financial-reporting";
import { requirePermission } from "@/server/auth/server-guards";
export default async function Page({ searchParams }: { searchParams: Promise<{ asOf?: string }> }) {
  await requirePermission("accounting.view");
  const q = await searchParams;
  const asOf = reportAsOf(q.asOf);
  const report = await receivableAging(asOf);
  return (
    <ResponsiveContainer>
      <PageHeader
        title="Accounts Receivable Aging"
        description="Open posted invoices, net of posted allocations as of the selected date."
      />
      <FinancialReportControls asOf={asOf.toISOString().slice(0, 10)} />
      <Card className="mb-4 grid gap-2 p-4 md:grid-cols-5">
        {report.buckets.map((bucket) => (
          <div key={bucket.name}>
            <p className="text-sm text-[var(--muted)]">{bucket.name}</p>
            <p className="font-semibold">{bucket.amount}</p>
          </div>
        ))}
      </Card>
      <Card className="overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr>
              <th className="p-3 text-left">Invoice</th>
              <th className="p-3 text-left">Customer</th>
              <th className="p-3 text-left">Due</th>
              <th className="p-3 text-right">Outstanding</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {report.items.map((row) => (
              <tr key={row.id}>
                <td className="p-3">{row.number}</td>
                <td className="p-3">{row.party}</td>
                <td className="p-3">{row.date.toISOString().slice(0, 10)}</td>
                <td className="p-3 text-right">{row.outstanding}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </ResponsiveContainer>
  );
}
