import Link from "next/link";
import { notFound } from "next/navigation";
import {
  CancelBatchForm,
  PlanBatchForm,
  ReleaseBatchForm,
} from "@/components/production/batch-actions";
import { PageHeader } from "@/components/layout/page-header";
import { Card } from "@/components/ui/card";
import { ResponsiveContainer } from "@/components/ui/responsive-container";
import { hasPermission } from "@/modules/access/domain/principal";
import type {
  ProductionMaterialRequirementRecord,
  ProductionPackagingRequirementRecord,
} from "@/modules/production/application/batch-contracts";
import type { BatchMaterialView } from "@/modules/production/application/material-contracts";
import type { BatchPackagingView } from "@/modules/production/application/packaging-contracts";
import { requirePermission } from "@/server/auth/server-guards";
import { PrismaProductionBatchRepository } from "@/server/production/prisma-production-batch-repository";
import { PrismaProductionMaterialRepository } from "@/server/production/prisma-production-material-repository";
import { PrismaProductionPackagingRepository } from "@/server/production/prisma-production-packaging-repository";
import {
  cancelProductionBatchAction,
  planProductionBatchAction,
  releaseProductionBatchAction,
} from "../actions";

export default async function ProductionBatchDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const principal = await requirePermission("production.view");
  const repository = new PrismaProductionBatchRepository();
  const batch = await repository.getBatch((await params).id);
  if (!batch) notFound();
  const [materialActuals, packagingActuals] = await Promise.all([
    ["RELEASED", "IN_PROGRESS"].includes(batch.status)
      ? new PrismaProductionMaterialRepository().getBatchMaterialView(batch.id)
      : null,
    batch.status === "IN_PROGRESS"
      ? new PrismaProductionPackagingRepository().getBatchPackagingView(batch.id)
      : null,
  ]);
  const canManage = hasPermission(principal, "production.manage");
  return (
    <ResponsiveContainer>
      <PageHeader
        title={batch.batchNumber}
        description={`${batch.status} production batch for ${batch.finishedGoodName}.`}
      />
      <div className="mb-4 flex flex-wrap gap-2">
        {canManage && batch.status === "DRAFT" && (
          <Link
            className="rounded-lg border px-4 py-2 text-sm font-semibold"
            href={`/production/batches/${batch.id}/edit`}
          >
            Edit DRAFT
          </Link>
        )}
        <Link
          className="rounded-lg border px-4 py-2 text-sm font-semibold"
          href={`/production/recipes/${batch.recipeId}`}
        >
          Exact recipe version
        </Link>
        {["RELEASED", "IN_PROGRESS"].includes(batch.status) && (
          <Link
            className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white"
            href={`/production/batches/${batch.id}/materials`}
          >
            Raw-material issue & consumption
          </Link>
        )}
        {batch.status === "IN_PROGRESS" && (
          <Link
            className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white"
            href={`/production/batches/${batch.id}/packaging`}
          >
            Packaging issue, usage & damage
          </Link>
        )}
        {["IN_PROGRESS", "COMPLETED"].includes(batch.status) && (
          <Link
            className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white"
            href={`/production/batches/${batch.id}/output`}
          >
            Output, yield & completion
          </Link>
        )}
      </div>
      {batch.hasShortage && batch.status !== "CANCELLED" && (
        <div className="mb-5 rounded-xl border border-amber-400 bg-amber-50 p-4 text-sm text-amber-950">
          Current AVAILABLE stock is below the recommended issue quantity on one or more lines.
          Availability is live and no stock has been reserved.
        </div>
      )}
      <Card className="mb-5 grid gap-4 p-5 md:grid-cols-2 xl:grid-cols-4">
        <Info label="Product" value={`${batch.finishedGoodCode} - ${batch.finishedGoodName}`} />
        <Info
          label="Recipe"
          value={`${batch.recipeCode} - ${batch.recipeName} / v${batch.recipeVersion}`}
        />
        <Info label="Status" value={batch.status} />
        <Info label="Planned date" value={batch.plannedProductionDate.toLocaleDateString()} />
        <Info
          label="Target completion"
          value={batch.targetCompletionDate?.toLocaleDateString() ?? "-"}
        />
        <Info
          label="Raw-material source"
          value={`${batch.rawMaterialWarehouseCode} - ${batch.rawMaterialWarehouseName}`}
        />
        <Info
          label="Packaging source"
          value={`${batch.packagingWarehouseCode} - ${batch.packagingWarehouseName}`}
        />
        <Info
          label="Finished-goods destination"
          value={`${batch.finishedGoodsDestinationWarehouseCode} - ${batch.finishedGoodsDestinationWarehouseName}`}
        />
        <Info label="Created by" value={batch.createdByName} />
        <Info
          label="Released"
          value={
            batch.releasedAt
              ? `${batch.releasedByName} - ${batch.releasedAt.toLocaleString()}`
              : "-"
          }
        />
        <Info
          label="Cancelled"
          value={
            batch.cancelledAt
              ? `${batch.cancelledByName} - ${batch.cancelledAt.toLocaleString()}`
              : "-"
          }
        />
        <Info label="Cancellation reason" value={batch.cancellationReason ?? "-"} />
      </Card>
      <Card className="mb-5 p-5">
        <h2 className="font-semibold">Production basis</h2>
        <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <Info
            label="Planned batch"
            value={`${batch.plannedBatchEnteredQuantity} ${batch.plannedBatchUnitSymbol}`}
          />
          <Info
            label="Canonical batch"
            value={`${batch.plannedBatchNormalizedQuantity} ${batch.plannedBatchCanonicalSymbol}`}
          />
          <Info label="Scale factor" value={batch.scaleFactor} />
          <Info
            label="Expected yield"
            value={batch.expectedYieldPercent ? `${batch.expectedYieldPercent}%` : "Not comparable"}
          />
          <Info
            label="Expected output"
            value={
              batch.plannedExpectedOutputNormalizedQuantity
                ? `${batch.plannedExpectedOutputNormalizedQuantity} ${batch.expectedOutputCanonicalSymbol}`
                : "Not specified"
            }
          />
          <Info
            label="Planned packing"
            value={`${batch.plannedCartons} cartons + ${batch.plannedLoosePieces} loose`}
          />
          <Info label="Total pieces" value={batch.plannedTotalPieces} />
          <Info
            label="Product content"
            value={`${batch.plannedProductContentNormalizedQuantity} ${batch.productContentCanonicalSymbol}`}
          />
          <Info
            label="Expected minus packaged content"
            value={
              batch.expectedOutputDifferenceNormalizedQuantity !== null
                ? `${batch.expectedOutputDifferenceNormalizedQuantity} ${batch.productContentCanonicalSymbol}`
                : "Not dimension-comparable"
            }
          />
        </div>
        {batch.expectedOutputDifferenceNormalizedQuantity !== null &&
          batch.expectedOutputDifferenceNormalizedQuantity !== "0" && (
            <p className="mt-4 rounded-lg bg-[var(--surface)] p-3 text-sm">
              Planned packaging content differs from expected output. Review the plan for retained
              bulk, samples, tolerances, or process variation.
            </p>
          )}
      </Card>
      <RequirementTable
        title="Raw-material requirements"
        kind="material"
        records={batch.materialRequirements}
      />
      <RequirementTable
        title="Packaging requirements"
        kind="packaging"
        records={batch.packagingRequirements}
      />
      {(materialActuals || packagingActuals) && (
        <ProductionActualSummary materials={materialActuals} packaging={packagingActuals} />
      )}
      <Card className="mb-5 p-5">
        <h2 className="font-semibold">Notes</h2>
        <p className="mt-2 whitespace-pre-wrap text-sm">{batch.notes ?? "-"}</p>
      </Card>
      {canManage && ["DRAFT", "PLANNED", "RELEASED"].includes(batch.status) && (
        <Card className="space-y-5 p-5">
          <h2 className="font-semibold">Lifecycle actions</h2>
          {batch.status === "DRAFT" && (
            <PlanBatchForm action={planProductionBatchAction} id={batch.id} />
          )}
          {batch.status === "PLANNED" && (
            <ReleaseBatchForm
              action={releaseProductionBatchAction}
              hasShortage={batch.hasShortage}
              id={batch.id}
            />
          )}
          <CancelBatchForm action={cancelProductionBatchAction} id={batch.id} />
          <p className="text-xs text-[var(--muted)]">
            Plan and release freeze the requirement snapshot but never reserve, issue, consume, or
            receive stock.
          </p>
        </Card>
      )}
    </ResponsiveContainer>
  );
}

function ProductionActualSummary({
  materials,
  packaging,
}: {
  materials: BatchMaterialView | null;
  packaging: BatchPackagingView | null;
}) {
  return (
    <Card className="mb-5 overflow-hidden">
      <div className="border-b p-5">
        <h2 className="font-semibold">Physical production summary</h2>
        <p className="mt-1 text-xs text-[var(--muted)]">
          Actuals come from posted ledger movements. Packaging variance is provisional until actual
          finished output exists.
        </p>
      </div>
      {materials && (
        <SummaryTable
          headers={["Item", "Planned", "Issued", "Returned", "Consumed", "Variance"]}
          rows={materials.requirements.map((line) => [
            line.itemCode,
            `${line.plannedQuantity} ${line.canonicalUnitSymbol}`,
            line.cumulativeIssued,
            line.cumulativeReturned,
            line.cumulativeConsumed,
            `${line.varianceQuantity} / ${line.varianceDirection}`,
          ])}
          title="Raw materials"
        />
      )}
      {packaging && (
        <SummaryTable
          headers={[
            "Item",
            "Standard",
            "Recommended",
            "Issued",
            "Returned",
            "Good consumed",
            "Damaged",
            "Held",
            "Provisional variance",
          ]}
          rows={packaging.requirements.map((line) => [
            line.itemCode,
            `${line.standardRequiredQuantity} ${line.canonicalUnitSymbol}`,
            line.recommendedIssueQuantity,
            line.cumulativeIssued,
            line.cumulativeReturned,
            line.cumulativeGoodConsumed,
            line.cumulativeDamaged,
            line.currentlyInProduction,
            `${line.provisionalVarianceQuantity} / ${line.provisionalVarianceDirection}`,
          ])}
          title="Packaging"
        />
      )}
    </Card>
  );
}

function SummaryTable({
  title,
  headers,
  rows,
}: {
  title: string;
  headers: readonly string[];
  rows: readonly (readonly string[])[];
}) {
  return (
    <div className="border-b p-5 last:border-b-0">
      <h3 className="mb-3 text-sm font-semibold">{title}</h3>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[55rem] text-left text-sm">
          <thead>
            <tr>
              {headers.map((header) => (
                <th className="p-2" key={header}>
                  {header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.join(":")}>
                {row.map((value, index) => (
                  <td className="p-2" key={`${index}:${value}`}>
                    {value}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function RequirementTable({
  title,
  kind,
  records,
}: {
  title: string;
  kind: "material" | "packaging";
  records: readonly (ProductionMaterialRequirementRecord | ProductionPackagingRequirementRecord)[];
}) {
  return (
    <Card className="mb-5 overflow-hidden">
      <div className="border-b p-5">
        <h2 className="font-semibold">{title}</h2>
        <p className="mt-1 text-xs text-[var(--muted)]">
          Availability is a live AVAILABLE ledger sum; shortage/surplus compares against recommended
          issue.
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[78rem] text-left text-sm">
          <thead className="bg-[var(--surface)]">
            <tr>
              <th className="p-3">Item</th>
              {kind === "material" && <th className="p-3">Recipe standard</th>}
              {kind === "material" && <th className="p-3">Scaled plan</th>}
              {kind === "packaging" && <th className="p-3">Basis</th>}
              {kind === "packaging" && <th className="p-3">Standard required</th>}
              <th className="p-3">Allowance</th>
              <th className="p-3">Recommended issue</th>
              <th className="p-3">Available</th>
              <th className="p-3">Shortage</th>
              <th className="p-3">Surplus</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {records.map((record) => {
              const material = "plannedNormalizedQuantity" in record ? record : null;
              const packaging = "usageBasis" in record ? record : null;
              return (
                <tr key={record.id}>
                  <td className="p-3">
                    <strong>{record.itemCode}</strong> - {record.itemName}
                  </td>
                  {material && (
                    <td className="p-3">
                      {material.standardNormalizedQuantity} {record.canonicalUnitSymbol}
                    </td>
                  )}
                  {material && (
                    <td className="p-3">
                      {material.plannedNormalizedQuantity} {record.canonicalUnitSymbol}
                    </td>
                  )}
                  {packaging && (
                    <td className="p-3">{packaging.usageBasis.replaceAll("_", " ")}</td>
                  )}
                  {packaging && (
                    <td className="p-3">
                      {packaging.standardRequiredQuantity} {record.canonicalUnitSymbol}
                    </td>
                  )}
                  <td className="p-3">{record.allowancePercent}%</td>
                  <td className="p-3">
                    {record.recommendedIssueQuantity} {record.canonicalUnitSymbol}
                  </td>
                  <td className="p-3">
                    {record.availableQuantity} {record.canonicalUnitSymbol}
                  </td>
                  <td
                    className={`p-3 ${record.shortageQuantity !== "0" ? "font-semibold text-amber-700" : ""}`}
                  >
                    {record.shortageQuantity}
                  </td>
                  <td className="p-3">{record.surplusQuantity}</td>
                </tr>
              );
            })}
            {records.length === 0 && (
              <tr>
                <td className="p-4 text-[var(--muted)]" colSpan={9}>
                  No requirements in this snapshot.
                </td>
              </tr>
            )}
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
      <dd className="mt-1 text-sm">{value}</dd>
    </div>
  );
}
