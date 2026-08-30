import { FinancialReportControls } from "@/components/accounting/financial-report-controls";
import { PageHeader } from "@/components/layout/page-header";
import { ResponsiveContainer } from "@/components/ui/responsive-container";
import { Card } from "@/components/ui/card";
import { inventoryValuation, reportAsOf } from "@/server/accounting/financial-reporting";
import { requirePermission } from "@/server/auth/server-guards";
export default async function Page({ searchParams }: { searchParams: Promise<{ asOf?: string }> }) {
  await requirePermission("accounting.view");
  const q = await searchParams;
  const asOf = reportAsOf(q.asOf);
  const report = await inventoryValuation(asOf);
  return (
    <ResponsiveContainer>
      <PageHeader
        title="Inventory Valuation & GL Reconciliation"
        description="Moving-weighted-average valuation is compared with mapped inventory control accounts."
      />
      <FinancialReportControls asOf={asOf.toISOString().slice(0, 10)} />
      <Card className="mb-4 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr>
              <th className="p-3 text-left">Inventory type</th>
              <th className="p-3 text-right">Valuation</th>
              <th className="p-3 text-right">GL</th>
              <th className="p-3 text-right">Difference</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {report.summary.map((row) => (
              <tr key={row.type}>
                <td className="p-3">{row.type}</td>
                <td className="p-3 text-right">{row.valuation}</td>
                <td className="p-3 text-right">{row.gl}</td>
                <td className="p-3 text-right">{row.difference}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      <p className="mb-3 text-sm">
        Non-final valuation entries through this date: <strong>{report.nonFinalEntryCount}</strong>
      </p>
      <Card className="overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr>
              <th className="p-3 text-left">Item</th>
              <th className="p-3 text-left">Type</th>
              <th className="p-3 text-right">Quantity</th>
              <th className="p-3 text-right">Value</th>
              <th className="p-3 text-right">Average cost</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {report.rows.map((row) => (
              <tr key={row.code}>
                <td className="p-3">
                  {row.code} — {row.name}
                </td>
                <td className="p-3">{row.type}</td>
                <td className="p-3 text-right">{row.quantity}</td>
                <td className="p-3 text-right">{row.value}</td>
                <td className="p-3 text-right">{row.unitCost ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </ResponsiveContainer>
  );
}
