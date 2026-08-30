import { FinancialReportControls } from "@/components/accounting/financial-report-controls";
import { PageHeader } from "@/components/layout/page-header";
import { ResponsiveContainer } from "@/components/ui/responsive-container";
import { Card } from "@/components/ui/card";
import { expenseAndTreasury, reportRange } from "@/server/accounting/financial-reporting";
import { requirePermission } from "@/server/auth/server-guards";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  await requirePermission("accounting.view");
  const q = await searchParams;
  const range = reportRange(q.from, q.to);
  const report = await expenseAndTreasury(range);
  return (
    <ResponsiveContainer>
      <PageHeader
        title="Expense & Treasury Analysis"
        description="Posted expense vouchers by GL account and cash/bank GL balances."
      />
      <FinancialReportControls
        from={range.from.toISOString().slice(0, 10)}
        to={range.to.toISOString().slice(0, 10)}
      />
      <Card className="mb-4 overflow-hidden">
        <h2 className="p-3 font-semibold">Treasury balances</h2>
        <table className="w-full text-sm">
          <tbody className="divide-y">
            {report.treasury.map((row) => (
              <tr key={row.code}>
                <td className="p-3">
                  {row.code} — {row.name}
                </td>
                <td className="p-3">{row.type}</td>
                <td className="p-3 text-right">{row.balance}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      <Card className="overflow-hidden">
        <h2 className="p-3 font-semibold">Expense account analysis</h2>
        <table className="w-full text-sm">
          <tbody className="divide-y">
            {report.expenses.map((row) => (
              <tr key={row.name}>
                <td className="p-3">{row.name}</td>
                <td className="p-3 text-right">{row.amount}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </ResponsiveContainer>
  );
}
