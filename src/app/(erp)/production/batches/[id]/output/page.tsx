import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { OutputTransactionForm } from "@/components/production/output-transaction-form";
import {
  CancelOutputForm,
  CompleteBatchForm,
  PostOutputForm,
} from "@/components/production/output-transaction-actions";
import { Card } from "@/components/ui/card";
import { ResponsiveContainer } from "@/components/ui/responsive-container";
import { hasPermission } from "@/modules/access/domain/principal";
import {
  PRODUCTION_OUTPUT_TYPES,
  type ProductionOutputType,
} from "@/modules/production/application/output-contracts";
import { requirePermission } from "@/server/auth/server-guards";
import { PrismaProductionOutputRepository } from "@/server/production/prisma-production-output-repository";
import {
  cancelOutputTransactionAction,
  completeBatchAction,
  postOutputTransactionAction,
  saveOutputTransactionAction,
} from "./actions";

export default async function ProductionOutputPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ type?: string }>;
}) {
  const principal = await requirePermission("production.view");
  const id = (await params).id;
  const repository = new PrismaProductionOutputRepository();
  const [view, units, warehouses] = await Promise.all([
    repository.getOutputView(id),
    repository.listUnits(),
    repository.listWarehouses(),
  ]);
  if (!view) notFound();
  const query = await searchParams;
  const selectedType: ProductionOutputType =
    PRODUCTION_OUTPUT_TYPES.find((type) => type === query.type) ?? "GOOD";
  const canManage =
    hasPermission(principal, "production.manage") && view.batchStatus === "IN_PROGRESS";
  return (
    <ResponsiveContainer>
      <PageHeader
        title={`${view.batchNumber} Output & Yield`}
        description={`${view.finishedGoodCode} - ${view.finishedGoodName}; physical production reconciliation with no costing or accounting.`}
      />
      <div className="mb-4 flex flex-wrap gap-2">
        <Link
          className="rounded-lg border px-4 py-2 text-sm font-semibold"
          href={`/production/batches/${id}`}
        >
          Batch detail
        </Link>
        {canManage &&
          PRODUCTION_OUTPUT_TYPES.map((type) => (
            <Link className={tab(type === selectedType)} href={`?type=${type}`} key={type}>
              {type === "GOOD"
                ? "Good output"
                : type === "REPROCESS"
                  ? "Reprocess output"
                  : type === "REJECTED"
                    ? "Rejected / scrap"
                    : "Process loss"}
            </Link>
          ))}
      </div>

      <Card className="mb-5 p-5">
        <h2 className="font-semibold">Planning & production lot</h2>
        <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <Info label="Recipe" value={`${view.recipeCode} / v${view.recipeVersion}`} />
          <Info label="Planned batch" value={view.plannedBatch} />
          <Info label="Expected output" value={view.plannedExpectedOutput ?? "Not configured"} />
          <Info label="Planned finished output" value={view.plannedFinishedOutput} />
          <Info
            label="Production lot"
            value={view.productionLot?.lotNumber ?? "Created on first posting"}
          />
          <Info
            label="Production date"
            value={view.productionLot?.productionDate.toLocaleDateString() ?? "-"}
          />
          <Info
            label="Expiry"
            value={view.productionLot?.expiryDate?.toLocaleDateString() ?? "Not specified"}
          />
          <Info label="Status" value={view.batchStatus} />
        </div>
      </Card>

      <Card className="mb-5 p-5">
        <h2 className="font-semibold">Finished and other output</h2>
        <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <Info
            label="Good output"
            value={`${view.goodCartons} cartons + ${view.goodLoosePieces} loose`}
          />
          <Info label="Canonical finished stock" value={`${view.goodTotalPieces} PCS`} />
          <Info
            label="Good net content"
            value={`${view.goodContent} ${view.productContentUnitSymbol}`}
          />
          <Info
            label="Reprocess"
            value={`${view.reprocessOutput} ${view.productContentUnitSymbol}`}
          />
          <Info
            label="Rejected / scrap"
            value={`${view.rejectedOutput} ${view.productContentUnitSymbol}`}
          />
          <Info
            label="Process loss"
            value={`${view.processLoss} ${view.productContentUnitSymbol}`}
          />
          <Info
            label="Total accounted output"
            value={`${view.reconciliation.totalAccountedOutput} ${view.productContentUnitSymbol}`}
          />
        </div>
      </Card>

      <Card className="mb-5 overflow-hidden">
        <div className="border-b p-5">
          <h2 className="font-semibold">Raw-material actuals</h2>
          <p className="mt-1 text-xs text-[var(--muted)]">
            Values are derived from the immutable Phase 12 issue, return, and consumption history.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[65rem] text-left text-sm">
            <thead className="bg-[var(--surface)]">
              <tr>
                <th className="p-3">Raw material</th>
                <th className="p-3">Planned</th>
                <th className="p-3">Issued</th>
                <th className="p-3">Returned</th>
                <th className="p-3">Consumed</th>
                <th className="p-3">Quantity variance</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {view.rawMaterials.map((line) => (
                <tr key={line.requirementId}>
                  <td className="p-3">
                    <strong>{line.itemCode}</strong> - {line.itemName}
                  </td>
                  {[line.planned, line.issued, line.returned, line.consumed].map((value, index) => (
                    <td className="p-3" key={`${index}:${value}`}>
                      {value} {line.unitSymbol}
                    </td>
                  ))}
                  <td className="p-3">
                    {line.variance} {line.unitSymbol} ({line.varianceDirection})
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card className="mb-5 p-5">
        <h2 className="font-semibold">Input reconciliation & yield</h2>
        <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {view.inputComponents.map((part) => (
            <Info
              key={`${part.dimension}:${part.unitSymbol}`}
              label={`Actual ${part.dimension} input`}
              value={`${part.quantity} ${part.unitSymbol}`}
            />
          ))}
          <Info label="Expected yield" value={percent(view.expectedYieldPercent)} />
          <Info label="Actual good yield" value={percent(view.reconciliation.goodYieldPercent)} />
          <Info
            label="Recoverable yield"
            value={percent(view.reconciliation.recoverableYieldPercent)}
          />
          <Info label="Process loss" value={percent(view.reconciliation.processLossPercent)} />
          <Info
            label="Expected vs actual"
            value={
              view.reconciliation.expectedYieldDifferencePoints === null
                ? "Not comparable"
                : `${view.reconciliation.expectedYieldDifferencePoints} percentage points`
            }
          />
          <Info
            label="Unreconciled difference"
            value={
              view.reconciliation.unreconciledDifference === null
                ? "Incompatible input basis"
                : `${view.reconciliation.unreconciledDifference} ${view.productContentUnitSymbol}`
            }
          />
        </div>
        {!view.reconciliation.compatible && (
          <p className="mt-4 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
            Automatic yield is unavailable because consumed raw inputs do not form one compatible{" "}
            {view.productContentDimension} basis. No MASS-to-VOLUME conversion was invented.
          </p>
        )}
        {view.reconciliation.unreconciledDifference !== null &&
          view.reconciliation.unreconciledDifference !== "0" && (
            <p className="mt-4 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
              The exact input/output difference remains visible and requires an explanation before
              completion.
            </p>
          )}
      </Card>

      <Card className="mb-5 overflow-hidden">
        <div className="border-b p-5">
          <h2 className="font-semibold">Final packaging variance from actual output</h2>
          <p className="mt-1 text-xs text-[var(--muted)]">
            Final standard uses posted good pieces for PER PIECE and posted cartons for PER CARTON.
            Planned figures remain unchanged.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[105rem] text-left text-sm">
            <thead className="bg-[var(--surface)]">
              <tr>
                <th className="p-3">Packaging</th>
                <th className="p-3">Basis</th>
                <th className="p-3">Planned</th>
                <th className="p-3">Final standard</th>
                <th className="p-3">Recommended</th>
                <th className="p-3">Good consumed</th>
                <th className="p-3">Damaged</th>
                <th className="p-3">Returned</th>
                <th className="p-3">Total depleted</th>
                <th className="p-3">Planned variance</th>
                <th className="p-3">Final variance</th>
                <th className="p-3">Good-use variance</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {view.packaging.map((line) => (
                <tr key={line.requirementId}>
                  <td className="p-3">
                    <strong>{line.itemCode}</strong> - {line.itemName}
                    {line.consistencyWarning && (
                      <span className="mt-1 block text-xs font-semibold text-amber-700">
                        {line.consistencyWarning}
                      </span>
                    )}
                  </td>
                  <td className="p-3">{line.usageBasis.replaceAll("_", " ")}</td>
                  {[
                    line.plannedStandard,
                    line.finalStandard,
                    line.recommendedIssue,
                    line.goodConsumed,
                    line.damaged,
                    line.returned,
                    line.totalDepleted,
                    line.plannedVariance,
                    line.finalVariance,
                    line.goodConsumptionVariance,
                  ].map((value, index) => (
                    <td className="p-3" key={`${index}:${value}`}>
                      {value} {line.unitSymbol}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card className="mb-5 overflow-hidden">
        <div className="border-b p-5">
          <h2 className="font-semibold">Input-to-output traceability</h2>
          <p className="mt-1 text-xs text-[var(--muted)]">
            Supplier lots are derived from posted Phase 12 consumption and linked through this batch
            to the finished production lot.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[60rem] text-left text-sm">
            <thead className="bg-[var(--surface)]">
              <tr>
                <th className="p-3">Raw material</th>
                <th className="p-3">Supplier</th>
                <th className="p-3">Supplier lot</th>
                <th className="p-3">GRN</th>
                <th className="p-3">Consumed</th>
                <th className="p-3">Finished lot</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {view.consumedSupplierLots.map((lot) => (
                <tr key={`${lot.itemCode}:${lot.goodsReceiptNumber}:${lot.supplierLotNumber}`}>
                  <td className="p-3">
                    {lot.itemCode} - {lot.itemName}
                  </td>
                  <td className="p-3">{lot.supplierName}</td>
                  <td className="p-3">{lot.supplierLotNumber ?? "Not supplied"}</td>
                  <td className="p-3">{lot.goodsReceiptNumber}</td>
                  <td className="p-3">
                    {lot.consumedQuantity} {lot.unitSymbol}
                  </td>
                  <td className="p-3">{view.productionLot?.lotNumber ?? "Pending posting"}</td>
                </tr>
              ))}
              {view.consumedSupplierLots.length === 0 && (
                <tr>
                  <td className="p-5 text-[var(--muted)]" colSpan={6}>
                    No posted raw-material consumption lots.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {canManage && (
        <Card className="mb-5 p-5">
          <h2 className="mb-4 font-semibold">
            New {selectedType.replaceAll("_", " ").toLowerCase()} draft
          </h2>
          <OutputTransactionForm
            action={saveOutputTransactionAction}
            type={selectedType}
            units={units}
            view={view}
            warehouses={warehouses}
          />
        </Card>
      )}

      <Card className="mb-5 overflow-hidden">
        <div className="border-b p-5">
          <h2 className="font-semibold">Output transaction history</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[92rem] text-left text-sm">
            <thead className="bg-[var(--surface)]">
              <tr>
                <th className="p-3">Document</th>
                <th className="p-3">Date</th>
                <th className="p-3">Type</th>
                <th className="p-3">Quantity</th>
                <th className="p-3">Production lot</th>
                <th className="p-3">Destination/status</th>
                <th className="p-3">Reason/user</th>
                <th className="p-3">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {view.transactions.map((transaction) => (
                <tr key={transaction.id}>
                  <td className="p-3 font-mono font-semibold">{transaction.outputNumber}</td>
                  <td className="p-3">{transaction.transactionDate.toLocaleString()}</td>
                  <td className="p-3">
                    {transaction.outputType.replaceAll("_", " ")}
                    {transaction.lossNature && (
                      <span className="block text-xs">
                        {transaction.lossNature} / {transaction.lossReason?.replaceAll("_", " ")}
                      </span>
                    )}
                  </td>
                  <td className="p-3">
                    {transaction.outputType === "GOOD"
                      ? `${transaction.cartons} cartons + ${transaction.loosePieces} loose / ${transaction.totalPieces} PCS`
                      : `${transaction.normalizedQuantity} ${transaction.canonicalUnitSymbol}`}
                  </td>
                  <td className="p-3">{transaction.productionLotNumber ?? "Pending"}</td>
                  <td className="p-3">
                    {transaction.destinationWarehouseName}
                    <span className="block text-xs">{transaction.status}</span>
                  </td>
                  <td className="p-3">
                    {transaction.notes ?? "-"}
                    <span className="block text-xs">
                      {transaction.postedByName ?? transaction.createdByName}
                    </span>
                  </td>
                  <td className="p-3">
                    {canManage && transaction.status === "DRAFT" && (
                      <div className="space-y-2">
                        <Link
                          className="inline-block rounded-lg border px-3 py-2 text-xs font-semibold"
                          href={`/production/batches/${id}/output/${transaction.id}/edit`}
                        >
                          Edit
                        </Link>
                        <PostOutputForm
                          action={postOutputTransactionAction}
                          batchId={id}
                          transactionId={transaction.id}
                        />
                        <CancelOutputForm
                          action={cancelOutputTransactionAction}
                          batchId={id}
                          transactionId={transaction.id}
                        />
                      </div>
                    )}
                  </td>
                </tr>
              ))}
              {view.transactions.length === 0 && (
                <tr>
                  <td className="p-5 text-[var(--muted)]" colSpan={8}>
                    No output transactions yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {canManage && (
        <Card className="p-5">
          <h2 className="mb-3 font-semibold">Batch completion</h2>
          <CompleteBatchForm
            action={completeBatchAction}
            batchId={id}
            blockers={view.completionBlockers}
            requiresExplanation={view.completionNeedsExplanation}
          />
        </Card>
      )}
      {view.batchStatus === "COMPLETED" && (
        <Card className="p-5">
          <h2 className="font-semibold">Completed batch</h2>
          <p className="mt-2 text-sm">
            Completed by {view.completedByName} at {view.completedAt?.toLocaleString()}.
          </p>
          <p className="mt-2 whitespace-pre-wrap text-sm">
            Reconciliation explanation:{" "}
            {view.completionExplanation ??
              "Exact compatible reconciliation; no explanation required."}
          </p>
        </Card>
      )}
    </ResponsiveContainer>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span className="block text-xs uppercase tracking-wide text-[var(--muted)]">{label}</span>
      <strong className="mt-1 block text-sm">{value}</strong>
    </div>
  );
}
function percent(value: string | null) {
  return value === null ? "Not calculable" : `${value}%`;
}
function tab(active: boolean) {
  return `rounded-lg border px-4 py-2 text-sm font-semibold ${active ? "bg-[var(--accent)] text-white" : ""}`;
}
