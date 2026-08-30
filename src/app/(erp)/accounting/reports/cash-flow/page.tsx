import { FinancialReportControls } from "@/components/accounting/financial-report-controls";
import { PageHeader } from "@/components/layout/page-header";
import { ResponsiveContainer } from "@/components/ui/responsive-container";
import { Card } from "@/components/ui/card";
import { cashFlow, reportRange } from "@/server/accounting/financial-reporting";
import { requirePermission } from "@/server/auth/server-guards";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  await requirePermission("accounting.view");
  const q = await searchParams;
  const range = reportRange(q.from, q.to);
  const report = await cashFlow(range);
  const rows = [
    ["Opening cash", report.openingCash],
    ["Operating cash movement", report.operating],
    ["Investing cash movement", report.investing],
    ["Financing cash movement", report.financing],
    ["Other / manually classified movement", report.other],
    ["Net change in cash", report.netChange],
    ["Closing cash", report.closingCash],
    ["Reconciliation difference", report.reconciliationDifference],
  ];
  return (
    <ResponsiveContainer>
      <PageHeader
        title="Cash Flow"
        description="Cash-account movement from posted journals; manual journals remain separately disclosed."
      />
      <FinancialReportControls
        from={range.from.toISOString().slice(0, 10)}
        to={range.to.toISOString().slice(0, 10)}
      />
      <Card className="overflow-hidden">
        <table className="w-full text-sm">
          <tbody className="divide-y">
            {rows.map(([label, amount]) => (
              <tr key={label}>
                <td className="p-3">{label}</td>
                <td className="p-3 text-right tabular-nums">{amount}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </ResponsiveContainer>
  );
}
