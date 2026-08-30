import { FinancialReportControls } from "@/components/accounting/financial-report-controls";
import { PageHeader } from "@/components/layout/page-header";
import { ResponsiveContainer } from "@/components/ui/responsive-container";
import { Card } from "@/components/ui/card";
import { productionCosting, reportAsOf } from "@/server/accounting/financial-reporting";
import { requirePermission } from "@/server/auth/server-guards";
export default async function Page({ searchParams }: { searchParams: Promise<{ asOf?: string }> }) {
  await requirePermission("accounting.view");
  const q = await searchParams;
  const asOf = reportAsOf(q.asOf);
  const report = await productionCosting(asOf);
  return (
    <ResponsiveContainer>
      <PageHeader
        title="WIP & Production Costing"
        description="Finalized batch cost snapshots and the mapped WIP control balance are reported separately."
      />
      <FinancialReportControls asOf={asOf.toISOString().slice(0, 10)} />
      <Card className="mb-4 grid gap-2 p-4 md:grid-cols-2">
        <div>
          WIP GL balance <strong>{report.wipGl}</strong>
        </div>
        <div>
          Finalized cost pools shown <strong>{report.finalizedCostPool}</strong>
        </div>
      </Card>
      <Card className="overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr>
              <th className="p-3 text-left">Batch</th>
              <th className="p-3 text-left">Product</th>
              <th className="p-3 text-right">Raw</th>
              <th className="p-3 text-right">Packaging</th>
              <th className="p-3 text-right">Additional</th>
              <th className="p-3 text-right">FG cost pool</th>
              <th className="p-3 text-right">Cost / piece</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {report.rows.map((row) => (
              <tr key={row.batch}>
                <td className="p-3">{row.batch}</td>
                <td className="p-3">{row.product}</td>
                <td className="p-3 text-right">{row.rawMaterialCost}</td>
                <td className="p-3 text-right">{row.packagingCost}</td>
                <td className="p-3 text-right">{row.additionalCost}</td>
                <td className="p-3 text-right">{row.finishedGoodsCostPool}</td>
                <td className="p-3 text-right">{row.costPerPiece}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </ResponsiveContainer>
  );
}
