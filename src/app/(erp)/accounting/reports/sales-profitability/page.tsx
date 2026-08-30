import { FinancialReportControls } from "@/components/accounting/financial-report-controls";
import { PageHeader } from "@/components/layout/page-header";
import { ResponsiveContainer } from "@/components/ui/responsive-container";
import { Card } from "@/components/ui/card";
import { reportRange, salesProfitability } from "@/server/accounting/financial-reporting";
import { requirePermission } from "@/server/auth/server-guards";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  await requirePermission("accounting.view");
  const q = await searchParams;
  const range = reportRange(q.from, q.to);
  const rows = await salesProfitability(range);
  return (
    <ResponsiveContainer>
      <PageHeader
        title="Sales & Product Profitability"
        description="Posted invoice lines are paired with item-linked posted COGS journals."
      />
      <FinancialReportControls
        from={range.from.toISOString().slice(0, 10)}
        to={range.to.toISOString().slice(0, 10)}
      />
      <Card className="overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr>
              <th className="p-3 text-left">Product</th>
              <th className="p-3 text-right">Quantity</th>
              <th className="p-3 text-right">Revenue</th>
              <th className="p-3 text-right">Discounts</th>
              <th className="p-3 text-right">COGS</th>
              <th className="p-3 text-right">Gross profit</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.map((row) => (
              <tr key={row.code}>
                <td className="p-3">
                  {row.code} — {row.name}
                </td>
                <td className="p-3 text-right">{row.quantity}</td>
                <td className="p-3 text-right">{row.revenue}</td>
                <td className="p-3 text-right">{row.discounts}</td>
                <td className="p-3 text-right">{row.cogs}</td>
                <td className="p-3 text-right">{row.grossProfit}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </ResponsiveContainer>
  );
}
