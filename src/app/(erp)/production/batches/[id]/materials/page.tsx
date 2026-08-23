import Link from "next/link";
import { notFound } from "next/navigation";
import { MaterialTransactionForm } from "@/components/production/material-transaction-form";
import {
  CancelMaterialTransactionForm,
  PostMaterialTransactionForm,
} from "@/components/production/material-transaction-actions";
import { PageHeader } from "@/components/layout/page-header";
import { Card } from "@/components/ui/card";
import { ResponsiveContainer } from "@/components/ui/responsive-container";
import { hasPermission } from "@/modules/access/domain/principal";
import {
  MATERIAL_TRANSACTION_TYPES,
  type MaterialTransactionType,
} from "@/modules/production/application/material-contracts";
import { requirePermission } from "@/server/auth/server-guards";
import { PrismaProductionMaterialRepository } from "@/server/production/prisma-production-material-repository";
import {
  cancelMaterialTransactionAction,
  postMaterialTransactionAction,
  saveMaterialTransactionAction,
} from "./actions";

export default async function BatchMaterialsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ type?: string }>;
}) {
  const principal = await requirePermission("production.view");
  const id = (await params).id;
  const repository = new PrismaProductionMaterialRepository();
  const [view, units, warehouses] = await Promise.all([
    repository.getBatchMaterialView(id),
    repository.listUnits(),
    repository.listWarehouses(),
  ]);
  if (!view) notFound();
  const canManage = hasPermission(principal, "production.manage");
  const query = await searchParams;
  const requested = MATERIAL_TRANSACTION_TYPES.find((candidate) => candidate === query.type);
  const selectedType: MaterialTransactionType =
    requested && (requested === "ISSUE" || view.batchStatus === "IN_PROGRESS")
      ? requested
      : "ISSUE";
  const canIssue = ["RELEASED", "IN_PROGRESS"].includes(view.batchStatus);
  const canResolve = view.batchStatus === "IN_PROGRESS";
  return (
    <ResponsiveContainer>
      <PageHeader
        title={`${view.batchNumber} Materials`}
        description={`Lot-level raw-material custody and consumption for ${view.finishedGoodCode} - ${view.finishedGoodName}.`}
      />
      <div className="mb-4 flex flex-wrap gap-2">
        <Link
          className="rounded-lg border px-4 py-2 text-sm font-semibold"
          href={`/production/batches/${id}`}
        >
          Batch detail
        </Link>
        {canManage && canIssue && (
          <Link className={tab(selectedType === "ISSUE")} href={`?type=ISSUE`}>
            Issue material
          </Link>
        )}
        {canManage && canResolve && (
          <Link className={tab(selectedType === "RETURN")} href={`?type=RETURN`}>
            Return unused
          </Link>
        )}
        {canManage && canResolve && (
          <Link className={tab(selectedType === "CONSUMPTION")} href={`?type=CONSUMPTION`}>
            Record consumption
          </Link>
        )}
      </div>
      <Card className="mb-5 overflow-hidden">
        <div className="border-b p-5">
          <h2 className="font-semibold">Material reconciliation</h2>
          <p className="mt-1 text-xs text-[var(--muted)]">
            Issued - returned - consumed = currently in production. Variance is consumed - planned.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[92rem] text-left text-sm">
            <thead className="bg-[var(--surface)]">
              <tr>
                <th className="p-3">Material</th>
                <th className="p-3">Planned</th>
                <th className="p-3">Allowance</th>
                <th className="p-3">Recommended</th>
                <th className="p-3">Available</th>
                <th className="p-3">Issued</th>
                <th className="p-3">Returned</th>
                <th className="p-3">Consumed</th>
                <th className="p-3">In production</th>
                <th className="p-3">Variance</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {view.requirements.map((line) => (
                <tr key={line.requirementId}>
                  <td className="p-3">
                    <strong>{line.itemCode}</strong> - {line.itemName}
                  </td>
                  <Quantity value={line.plannedQuantity} symbol={line.canonicalUnitSymbol} />
                  <td className="p-3">{line.allowancePercent}%</td>
                  <Quantity
                    value={line.recommendedIssueQuantity}
                    symbol={line.canonicalUnitSymbol}
                  />
                  <Quantity value={line.availableQuantity} symbol={line.canonicalUnitSymbol} />
                  <Quantity value={line.cumulativeIssued} symbol={line.canonicalUnitSymbol} />
                  <Quantity value={line.cumulativeReturned} symbol={line.canonicalUnitSymbol} />
                  <Quantity value={line.cumulativeConsumed} symbol={line.canonicalUnitSymbol} />
                  <Quantity value={line.currentlyInProduction} symbol={line.canonicalUnitSymbol} />
                  <td
                    className={`p-3 font-semibold ${line.varianceDirection === "OVER" ? "text-amber-700" : line.varianceDirection === "UNDER" ? "text-blue-700" : "text-emerald-700"}`}
                  >
                    {line.varianceQuantity} {line.canonicalUnitSymbol} / {line.varianceDirection}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      {canManage && (canIssue || canResolve) && (
        <Card className="mb-5 p-5">
          <h2 className="mb-4 font-semibold">New {selectedType.toLowerCase()} draft</h2>
          <MaterialTransactionForm
            action={saveMaterialTransactionAction}
            type={selectedType}
            units={units}
            view={view}
            warehouses={warehouses}
          />
        </Card>
      )}
      <Card className="overflow-hidden">
        <div className="border-b p-5">
          <h2 className="font-semibold">Material transaction history</h2>
          <p className="mt-1 text-xs text-[var(--muted)]">
            Posted rows are immutable views of central Inventory Ledger events.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[90rem] text-left text-sm">
            <thead className="bg-[var(--surface)]">
              <tr>
                <th className="p-3">Transaction</th>
                <th className="p-3">Date</th>
                <th className="p-3">Type</th>
                <th className="p-3">Material</th>
                <th className="p-3">Lot / GRN</th>
                <th className="p-3">Quantity</th>
                <th className="p-3">Warehouse</th>
                <th className="p-3">Status / user</th>
                <th className="p-3">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {view.transactions.map((transaction) => (
                <tr key={transaction.id}>
                  <td className="p-3 font-mono font-semibold">{transaction.transactionNumber}</td>
                  <td className="p-3">{transaction.transactionDate.toLocaleString()}</td>
                  <td className="p-3">{transaction.transactionType}</td>
                  <td className="p-3">
                    {transaction.line.itemCode} - {transaction.line.itemName}
                  </td>
                  <td className="p-3">
                    {transaction.line.supplierLotNumber ?? "No supplier lot"}
                    <span className="block text-xs">{transaction.line.goodsReceiptNumber}</span>
                  </td>
                  <td className="p-3">
                    {transaction.line.enteredQuantity} {transaction.line.enteredUnitSymbol}
                    <span className="block text-xs">
                      {transaction.line.normalizedQuantity} {transaction.line.canonicalUnitSymbol}
                    </span>
                  </td>
                  <td className="p-3">
                    {transaction.line.sourceWarehouseName}
                    {transaction.line.destinationWarehouseName && (
                      <span className="block text-xs">
                        to {transaction.line.destinationWarehouseName}
                      </span>
                    )}
                  </td>
                  <td className="p-3">
                    {transaction.status}
                    <span className="block text-xs">
                      {transaction.postedByName ?? transaction.createdByName}
                    </span>
                  </td>
                  <td className="p-3">
                    {canManage && transaction.status === "DRAFT" && (
                      <div className="space-y-2">
                        <Link
                          className="inline-block rounded-lg border px-3 py-2 text-xs font-semibold"
                          href={`/production/batches/${id}/materials/${transaction.id}/edit`}
                        >
                          Edit
                        </Link>
                        <PostMaterialTransactionForm
                          action={postMaterialTransactionAction}
                          productionBatchId={id}
                          transactionId={transaction.id}
                        />
                        <CancelMaterialTransactionForm
                          action={cancelMaterialTransactionAction}
                          productionBatchId={id}
                          transactionId={transaction.id}
                        />
                      </div>
                    )}
                  </td>
                </tr>
              ))}
              {view.transactions.length === 0 && (
                <tr>
                  <td className="p-5 text-[var(--muted)]" colSpan={9}>
                    No material transactions yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </ResponsiveContainer>
  );
}

function Quantity({ value, symbol }: { value: string; symbol: string }) {
  return (
    <td className="p-3">
      {value} {symbol}
    </td>
  );
}
function tab(active: boolean) {
  return `rounded-lg border px-4 py-2 text-sm font-semibold ${active ? "bg-[var(--accent)] text-white" : ""}`;
}
