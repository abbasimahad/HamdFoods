import { FinancialReportControls } from "@/components/accounting/financial-report-controls";
import { PageHeader } from "@/components/layout/page-header";
import { ResponsiveContainer } from "@/components/ui/responsive-container";
import { Card } from "@/components/ui/card";
import { balanceSheet, reportAsOf } from "@/server/accounting/financial-reporting";
import { requirePermission } from "@/server/auth/server-guards";

export default async function Page({ searchParams }: { searchParams: Promise<{ asOf?: string }> }) {
  await requirePermission("accounting.view");
  const query = await searchParams;
  const asOf = reportAsOf(query.asOf);
  const report = await balanceSheet(asOf);
  const group = (
    title: string,
    rows: readonly { code: string; name: string; amount: string }[],
  ) => (
    <section>
      <h2 className="p-3 font-semibold">{title}</h2>
      <table className="w-full text-sm">
        <tbody className="divide-y">
          {rows.map((row) => (
            <tr key={row.code}>
              <td className="p-3">
                {row.code} — {row.name}
              </td>
              <td className="p-3 text-right tabular-nums">{row.amount}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
  return (
    <ResponsiveContainer>
      <PageHeader
        title="Balance Sheet"
        description={`Posted journals only · As of ${asOf.toISOString().slice(0, 10)}`}
      />
      <FinancialReportControls asOf={asOf.toISOString().slice(0, 10)} />
      <Card className="overflow-hidden">
        {group("Assets", report.assetRows)}
        {group("Liabilities", report.liabilityRows)}
        {group("Equity", report.equityRows)}
        <table className="w-full border-t text-sm">
          <tbody>
            <tr className="font-semibold">
              <td className="p-3">Current-year earnings</td>
              <td className="p-3 text-right">{report.currentEarnings}</td>
            </tr>
            <tr className="font-semibold">
              <td className="p-3">Total assets</td>
              <td className="p-3 text-right">{report.assets}</td>
            </tr>
            <tr className="font-semibold">
              <td className="p-3">Total liabilities and equity</td>
              <td className="p-3 text-right">{report.totalLiabilitiesAndEquity}</td>
            </tr>
            <tr className="font-semibold">
              <td className="p-3">Balance-sheet difference</td>
              <td className="p-3 text-right">{report.difference}</td>
            </tr>
          </tbody>
        </table>
      </Card>
    </ResponsiveContainer>
  );
}
