import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { PackagingTransactionForm } from "@/components/production/packaging-transaction-form";
import {
  CancelMaterialTransactionForm,
  PostMaterialTransactionForm,
} from "@/components/production/material-transaction-actions";
import { Card } from "@/components/ui/card";
import { ResponsiveContainer } from "@/components/ui/responsive-container";
import { hasPermission } from "@/modules/access/domain/principal";
import {
  PACKAGING_TRANSACTION_TYPES,
  type PackagingTransactionType,
} from "@/modules/production/application/packaging-contracts";
import { requirePermission } from "@/server/auth/server-guards";
import { PrismaProductionPackagingRepository } from "@/server/production/prisma-production-packaging-repository";
import {
  cancelPackagingTransactionAction,
  postPackagingTransactionAction,
  savePackagingTransactionAction,
} from "./actions";

export default async function BatchPackagingPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ type?: string }>;
}) {
  const principal = await requirePermission("production.view");
  const id = (await params).id;
  const repository = new PrismaProductionPackagingRepository();
  const [view, units, warehouses] = await Promise.all([
    repository.getBatchPackagingView(id),
    repository.listUnits(),
    repository.listWarehouses(),
  ]);
  if (!view) notFound();
  const query = await searchParams;
  const requested = PACKAGING_TRANSACTION_TYPES.find((type) => type === query.type);
  const selectedType: PackagingTransactionType = requested ?? "ISSUE";
  const canManage =
    hasPermission(principal, "production.manage") && view.batchStatus === "IN_PROGRESS";
  return (
    <ResponsiveContainer>
      <PageHeader
        title={`${view.batchNumber} Packaging`}
        description={`Lot-level packaging custody, good consumption, and damage for ${view.finishedGoodCode} - ${view.finishedGoodName}.`}
      />
      <div className="mb-4 flex flex-wrap gap-2">
        <Link
          className="rounded-lg border px-4 py-2 text-sm font-semibold"
          href={`/production/batches/${id}`}
        >
          Batch detail
        </Link>
        {canManage &&
          PACKAGING_TRANSACTION_TYPES.map((type) => (
            <Link className={tab(type === selectedType)} href={`?type=${type}`} key={type}>
              {type === "ISSUE"
                ? "Issue packaging"
                : type === "RETURN"
                  ? "Return unused"
                  : type === "CONSUMPTION"
                    ? "Record good consumption"
                    : "Record damage"}
            </Link>
          ))}
      </div>
      <Card className="mb-5 overflow-hidden">
        <div className="border-b p-5">
          <h2 className="font-semibold">Packaging reconciliation</h2>
          <p className="mt-1 text-xs text-[var(--muted)]">
            Issued - returned - good consumed - damaged = held. Provisional variance compares total
            depleted with the frozen planned standard.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[128rem] text-left text-sm">
            <thead className="bg-[var(--surface)]">
              <tr>
                <th className="p-3">Packaging</th>
                <th className="p-3">Basis</th>
                <th className="p-3">Standard</th>
                <th className="p-3">Allowance</th>
                <th className="p-3">Recommended</th>
                <th className="p-3">Available</th>
                <th className="p-3">Issued</th>
                <th className="p-3">Returned</th>
                <th className="p-3">Good consumed</th>
                <th className="p-3">Damaged</th>
                <th className="p-3">Held</th>
                <th className="p-3">Total depleted</th>
                <th className="p-3">Provisional variance</th>
                <th className="p-3">Good-use variance</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {view.requirements.map((line) => (
                <tr key={line.requirementId}>
                  <td className="p-3">
                    <strong>{line.itemCode}</strong> - {line.itemName}
                  </td>
                  <td className="p-3">{line.usageBasis.replaceAll("_", " ")}</td>
                  <Q value={line.standardRequiredQuantity} unit={line.canonicalUnitSymbol} />
                  <td className="p-3">{line.allowancePercent}%</td>
                  <Q value={line.recommendedIssueQuantity} unit={line.canonicalUnitSymbol} />
                  <Q value={line.availableQuantity} unit={line.canonicalUnitSymbol} />
                  <Q value={line.cumulativeIssued} unit={line.canonicalUnitSymbol} />
                  <Q value={line.cumulativeReturned} unit={line.canonicalUnitSymbol} />
                  <Q value={line.cumulativeGoodConsumed} unit={line.canonicalUnitSymbol} />
                  <Q value={line.cumulativeDamaged} unit={line.canonicalUnitSymbol} />
                  <Q value={line.currentlyInProduction} unit={line.canonicalUnitSymbol} />
                  <Q value={line.totalDepleted} unit={line.canonicalUnitSymbol} />
                  <Variance
                    value={line.provisionalVarianceQuantity}
                    direction={line.provisionalVarianceDirection}
                    unit={line.canonicalUnitSymbol}
                  />
                  <Variance
                    value={line.goodConsumptionVarianceQuantity}
                    direction={line.goodConsumptionVarianceDirection}
                    unit={line.canonicalUnitSymbol}
                  />
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      {canManage && (
        <Card className="mb-5 p-5">
          <h2 className="mb-4 font-semibold">New {selectedType.toLowerCase()} draft</h2>
          <PackagingTransactionForm
            action={savePackagingTransactionAction}
            type={selectedType}
            units={units}
            view={view}
            warehouses={warehouses}
          />
        </Card>
      )}
      <Card className="overflow-hidden">
        <div className="border-b p-5">
          <h2 className="font-semibold">Packaging transaction history</h2>
          <p className="mt-1 text-xs text-[var(--muted)]">
            Posted rows are immutable views of central Inventory Ledger events.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[96rem] text-left text-sm">
            <thead className="bg-[var(--surface)]">
              <tr>
                <th className="p-3">Transaction</th>
                <th className="p-3">Date</th>
                <th className="p-3">Action</th>
                <th className="p-3">Packaging</th>
                <th className="p-3">Lot / GRN</th>
                <th className="p-3">Quantity</th>
                <th className="p-3">Warehouse</th>
                <th className="p-3">User / status</th>
                <th className="p-3">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {view.transactions.map((transaction) => (
                <tr key={transaction.id}>
                  <td className="p-3 font-mono font-semibold">{transaction.transactionNumber}</td>
                  <td className="p-3">{transaction.transactionDate.toLocaleString()}</td>
                  <td className="p-3">
                    {transaction.transactionType}
                    {transaction.damageReason && (
                      <span className="block text-xs">
                        {transaction.damageReason.replaceAll("_", " ")}
                      </span>
                    )}
                  </td>
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
                    {transaction.postedByName ?? transaction.createdByName}
                    <span className="block text-xs">{transaction.status}</span>
                  </td>
                  <td className="p-3">
                    {canManage && transaction.status === "DRAFT" && (
                      <div className="space-y-2">
                        <Link
                          className="inline-block rounded-lg border px-3 py-2 text-xs font-semibold"
                          href={`/production/batches/${id}/packaging/${transaction.id}/edit`}
                        >
                          Edit
                        </Link>
                        <PostMaterialTransactionForm
                          action={postPackagingTransactionAction}
                          productionBatchId={id}
                          transactionId={transaction.id}
                        />
                        <CancelMaterialTransactionForm
                          action={cancelPackagingTransactionAction}
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
                    No packaging transactions yet.
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

function Q({ value, unit }: { value: string; unit: string }) {
  return (
    <td className="p-3">
      {value} {unit}
    </td>
  );
}
function Variance({
  value,
  direction,
  unit,
}: {
  value: string;
  direction: "OVER" | "UNDER" | "EXACT";
  unit: string;
}) {
  return (
    <td
      className={`p-3 font-semibold ${direction === "OVER" ? "text-amber-700" : direction === "UNDER" ? "text-blue-700" : "text-emerald-700"}`}
    >
      {value} {unit} / {direction}
    </td>
  );
}
function tab(active: boolean) {
  return `rounded-lg border px-4 py-2 text-sm font-semibold ${active ? "bg-[var(--accent)] text-white" : ""}`;
}
