import { notFound } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { Card } from "@/components/ui/card";
import { ResponsiveContainer } from "@/components/ui/responsive-container";
import { derivedCartonCost, formatCost } from "@/modules/costing/domain/costing";
import { requirePermission } from "@/server/auth/server-guards";
import { PrismaInventoryValuationRepository } from "@/server/costing/prisma-inventory-valuation-repository";

export default async function ItemValuationHistoryPage({
  params,
}: {
  params: Promise<{ itemId: string }>;
}) {
  await requirePermission("inventory.view");
  const record = await new PrismaInventoryValuationRepository().getItemHistory(
    (await params).itemId,
  );
  if (!record) notFound();
  return (
    <ResponsiveContainer>
      <PageHeader
        title={`${record.summary.itemCode} — ${record.summary.itemName}`}
        description="Immutable monetary valuation history. Positive quantities enter ownership; negative quantities leave ownership."
      />
      <Card className="mb-5 grid gap-4 p-5 md:grid-cols-4">
        <Info
          label="Canonical quantity"
          value={`${record.summary.canonicalQuantity} ${record.summary.canonicalUnitSymbol}`}
        />
        <Info label="Moving average" value={formatCost(record.summary.averageUnitCost, 6)} />
        <Info label="Inventory value" value={formatCost(record.summary.inventoryValue)} />
        <Info label="Missing basis" value={String(record.summary.missingBasisCount)} />
        {record.summary.piecesPerCarton && (
          <Info
            label="Derived carton cost"
            value={
              record.summary.averageUnitCost
                ? derivedCartonCost(record.summary.averageUnitCost, record.summary.piecesPerCarton)
                : "Missing"
            }
          />
        )}
      </Card>
      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[90rem] text-left text-sm">
            <thead className="bg-[var(--surface)]">
              <tr>
                <th className="p-3">Date</th>
                <th className="p-3">Source</th>
                <th className="p-3">Type / state</th>
                <th className="p-3">Qty in/out</th>
                <th className="p-3">Unit cost</th>
                <th className="p-3">Value in/out</th>
                <th className="p-3">Running qty</th>
                <th className="p-3">Running value</th>
                <th className="p-3">Average</th>
                <th className="p-3">User</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {record.history.map((row) => (
                <tr key={row.id}>
                  <td className="p-3">{row.effectiveAt.toLocaleString()}</td>
                  <td className="p-3">{row.sourceNumber ?? row.sourceType}</td>
                  <td className="p-3">
                    {row.entryType} / {row.state}
                  </td>
                  <td className="p-3">{row.quantityEffect}</td>
                  <td className="p-3">{formatCost(row.unitCost, 6)}</td>
                  <td className="p-3">{formatCost(row.valueDelta)}</td>
                  <td className="p-3">{row.runningOwnedQuantity}</td>
                  <td className="p-3">{formatCost(row.runningInventoryValue)}</td>
                  <td className="p-3">{formatCost(row.resultingAverageUnitCost, 6)}</td>
                  <td className="p-3">{row.createdByName}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </ResponsiveContainer>
  );
}
function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-[var(--muted)]">{label}</dt>
      <dd className="mt-1 font-semibold">{value}</dd>
    </div>
  );
}
