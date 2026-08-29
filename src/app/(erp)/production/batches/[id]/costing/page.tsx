import { notFound } from "next/navigation";
import {
  AddProductionCostForm,
  FinalizeProductionCostForm,
} from "@/components/costing/production-cost-actions";
import { PageHeader } from "@/components/layout/page-header";
import { Card } from "@/components/ui/card";
import { ResponsiveContainer } from "@/components/ui/responsive-container";
import { hasPermission } from "@/modules/access/domain/principal";
import { formatCost } from "@/modules/costing/domain/costing";
import { requirePermission } from "@/server/auth/server-guards";
import { PrismaInventoryValuationRepository } from "@/server/costing/prisma-inventory-valuation-repository";
import { addProductionCostAction, finalizeProductionCostAction } from "./actions";

export default async function BatchCostingPage({ params }: { params: Promise<{ id: string }> }) {
  const principal = await requirePermission("production.view");
  const costing = await new PrismaInventoryValuationRepository().getBatchCosting((await params).id);
  if (!costing) notFound();
  const canManage = hasPermission(principal, "production.manage");
  return (
    <ResponsiveContainer>
      <PageHeader
        title={`${costing.batchNumber} Costing`}
        description={`${costing.finishedGoodCode} — ${costing.finishedGoodName}; ${costing.costingStatus}. Costing has no physical quantity or General Ledger side effect.`}
      />
      {costing.warnings.length > 0 && (
        <Card className="mb-5 border-amber-300 bg-amber-50 p-5">
          <h2 className="font-semibold">Costing blockers</h2>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
            {costing.warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </Card>
      )}
      <CostTable title="Raw materials" lines={costing.rawMaterials} />
      <CostTable title="Good packaging consumption" lines={costing.packaging} />
      <CostTable
        title="Damaged packaging carrying-cost exposure"
        lines={costing.damagedPackaging}
      />
      <Card className="mt-5 overflow-hidden">
        <h2 className="p-5 font-semibold">Additional manufacturing cost and recovery credits</h2>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[50rem] text-left text-sm">
            <thead className="bg-[var(--surface)]">
              <tr>
                <th className="p-3">Category</th>
                <th className="p-3">Amount</th>
                <th className="p-3">Description</th>
                <th className="p-3">Reference</th>
                <th className="p-3">Created by</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {costing.manualEntries.map((row) => (
                <tr key={row.id}>
                  <td className="p-3">{row.category.replaceAll("_", " ")}</td>
                  <td className="p-3">{formatCost(row.amount)}</td>
                  <td className="p-3">{row.description}</td>
                  <td className="p-3">{row.reference ?? "—"}</td>
                  <td className="p-3">{row.createdByName}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {canManage && costing.costingStatus !== "FINALIZED" && (
          <div className="border-t p-5">
            <AddProductionCostForm action={addProductionCostAction} batchId={costing.batchId} />
          </div>
        )}
      </Card>
      <Card className="mt-5 grid gap-4 p-5 md:grid-cols-3 xl:grid-cols-5">
        <Info label="Raw material cost" value={formatCost(costing.rawMaterialCost)} />
        <Info label="Packaging cost" value={formatCost(costing.packagingCost)} />
        <Info label="Additional cost" value={formatCost(costing.additionalCost)} />
        <Info label="Cost credits" value={formatCost(costing.costCredits)} />
        <Info label="FG cost pool" value={formatCost(costing.finishedGoodsCostPool)} />
        <Info label="Actual pieces" value={costing.actualGoodPieces} />
        <Info label="Cost per piece" value={formatCost(costing.costPerPiece, 6)} />
        <Info label="Cost per carton" value={formatCost(costing.costPerCarton, 6)} />
        <Info
          label="Damaged packaging exposure"
          value={formatCost(costing.damagedPackagingExposure)}
        />
        <Info label="Abnormal loss quantity" value={costing.abnormalLossQuantity} />
      </Card>
      {costing.finalizedAt ? (
        <Card className="mt-5 p-5 text-sm">
          Finalized by <strong>{costing.finalizedByName}</strong> on{" "}
          {costing.finalizedAt.toLocaleString()}.
        </Card>
      ) : (
        canManage && (
          <Card className="mt-5 space-y-3 p-5">
            <h2 className="font-semibold">Finalize production cost</h2>
            <p className="text-sm text-[var(--muted)]">
              Requires a completed physical batch, valued actual consumption, positive good output,
              and no missing basis.
            </p>
            <FinalizeProductionCostForm
              action={finalizeProductionCostAction}
              batchId={costing.batchId}
            />
          </Card>
        )
      )}
    </ResponsiveContainer>
  );
}
function CostTable({
  title,
  lines,
}: {
  title: string;
  lines: readonly {
    itemCode: string;
    itemName: string;
    quantity: string;
    unitCost: string | null;
    totalCost: string | null;
    plannedQuantity: string | null;
  }[];
}) {
  return (
    <Card className="mb-5 overflow-hidden">
      <h2 className="p-5 font-semibold">{title}</h2>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[55rem] text-left text-sm">
          <thead className="bg-[var(--surface)]">
            <tr>
              <th className="p-3">Item</th>
              <th className="p-3">Planned qty</th>
              <th className="p-3">Actual qty</th>
              <th className="p-3">Unit cost</th>
              <th className="p-3">Total cost</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {lines.map((line, index) => (
              <tr key={`${line.itemCode}-${index}`}>
                <td className="p-3">
                  {line.itemCode} — {line.itemName}
                </td>
                <td className="p-3">{line.plannedQuantity ?? "—"}</td>
                <td className="p-3">{line.quantity}</td>
                <td className="p-3">{formatCost(line.unitCost, 6)}</td>
                <td className="p-3">{formatCost(line.totalCost)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
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
