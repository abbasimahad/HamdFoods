import { FinancialReportControls } from "@/components/accounting/financial-report-controls";
import { PageHeader } from "@/components/layout/page-header";
import { ResponsiveContainer } from "@/components/ui/responsive-container";
import { Card } from "@/components/ui/card";
import { profitAndLoss, reportRange } from "@/server/accounting/financial-reporting";
import { requirePermission } from "@/server/auth/server-guards";

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  await requirePermission("accounting.view");
  const query = await searchParams;
  const range = reportRange(query.from, query.to);
  const report = await profitAndLoss(range);
  const rows = [
    ["Sales revenue", report.salesRevenue],
    ["Sales discounts", `(${report.salesDiscounts})`],
    ["Sales returns & allowances", `(${report.salesReturns})`],
    ["Net sales", report.netSales],
    ["Cost of goods sold", `(${report.cogs})`],
    ["Gross profit", report.grossProfit],
    ["Operating expenses", `(${report.operatingExpenses})`],
    ["Net profit / (loss)", report.netProfit],
  ];
  return (
    <ResponsiveContainer>
      <PageHeader
        title="Profit & Loss"
        description={`Posted journals only · ${range.from.toISOString().slice(0, 10)} to ${range.to.toISOString().slice(0, 10)}`}
      />
      <FinancialReportControls
        from={range.from.toISOString().slice(0, 10)}
        to={range.to.toISOString().slice(0, 10)}
      />
      <Card className="overflow-hidden">
        <table className="w-full text-sm">
          <tbody className="divide-y">
            {rows.map(([label, amount]) => (
              <tr
                key={label}
                className={
                  String(label).includes("profit") || label === "Net sales" ? "font-semibold" : ""
                }
              >
                <td className="p-3">{label}</td>
                <td className="p-3 text-right tabular-nums">{amount}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      <Card className="mt-4 overflow-hidden">
        <h2 className="p-3 font-semibold">Operating expense detail</h2>
        <table className="w-full text-sm">
          <tbody className="divide-y">
            {report.operatingExpenseRows.map((row) => (
              <tr key={row.code}>
                <td className="p-3">
                  {row.code} — {row.name}
                </td>
                <td className="p-3 text-right tabular-nums">{row.amount}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </ResponsiveContainer>
  );
}
