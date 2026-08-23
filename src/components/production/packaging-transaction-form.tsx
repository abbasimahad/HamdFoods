"use client";

import { useActionState, useMemo, useState } from "react";
import type { ProductionActionState } from "./action-state";
import type { BatchWarehouseOption } from "@/modules/production/application/batch-contracts";
import type { RecipeUnit } from "@/modules/production/application/contracts";
import {
  PACKAGING_DAMAGE_REASONS,
  type BatchPackagingView,
  type PackagingTransactionRecord,
  type PackagingTransactionType,
} from "@/modules/production/application/packaging-contracts";

export function PackagingTransactionForm({
  action,
  view,
  type,
  units,
  warehouses,
  initial,
}: {
  action: (state: ProductionActionState, data: FormData) => Promise<ProductionActionState>;
  view: BatchPackagingView;
  type: PackagingTransactionType;
  units: readonly RecipeUnit[];
  warehouses: readonly BatchWarehouseOption[];
  initial?: PackagingTransactionRecord;
}) {
  const [state, formAction, pending] = useActionState(action, { ok: false, message: "" });
  const [requirementId, setRequirementId] = useState(
    initial?.line.packagingRequirementId ?? view.requirements[0]?.requirementId ?? "",
  );
  const requirement = view.requirements.find(
    (candidate) => candidate.requirementId === requirementId,
  );
  const lots = useMemo(
    () =>
      (type === "ISSUE" ? view.availableLots : view.heldLots).filter(
        (lot) => lot.itemId === requirement?.itemId,
      ),
    [type, view.availableLots, view.heldLots, requirement?.itemId],
  );
  const [lotId, setLotId] = useState(initial?.line.inventoryLotId ?? lots[0]?.id ?? "");
  const lot = lots.find((candidate) => candidate.id === lotId);
  const compatibleUnits = units.filter(
    (unit) => unit.dimension === requirement?.canonicalUnitDimension,
  );
  return (
    <form action={formAction} className="space-y-5">
      {initial && <input name="id" type="hidden" value={initial.id} />}
      <input name="productionBatchId" type="hidden" value={view.productionBatchId} />
      <input name="transactionType" type="hidden" value={type} />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Field label="Operation" value={type} />
        <label className="text-sm font-medium">
          Transaction time
          <input
            className="mt-1 min-h-11 w-full rounded-lg border px-3"
            defaultValue={dateTimeLocal(initial?.transactionDate)}
            name="transactionDate"
            required
            type="datetime-local"
          />
        </label>
        <label className="text-sm font-medium">
          Packaging requirement
          <select
            className="mt-1 min-h-11 w-full rounded-lg border bg-white px-3"
            name="packagingRequirementId"
            onChange={(event) => {
              setRequirementId(event.target.value);
              setLotId("");
            }}
            required
            value={requirementId}
          >
            <option value="">Select</option>
            {view.requirements.map((record) => (
              <option key={record.requirementId} value={record.requirementId}>
                {record.itemCode} - {record.itemName}
              </option>
            ))}
          </select>
        </label>
        <Field label="Custody/source warehouse" value={view.packagingWarehouseName} />
        <label className="text-sm font-medium xl:col-span-2">
          Inventory lot
          <select
            className="mt-1 min-h-11 w-full rounded-lg border bg-white px-3"
            name="inventoryLotId"
            onChange={(event) => setLotId(event.target.value)}
            required
            value={lotId}
          >
            <option value="">Select eligible lot</option>
            {lots.map((option) => (
              <option key={option.id} value={option.id}>
                {option.supplierLotNumber ?? "No supplier lot"} / {option.goodsReceiptNumber} /{" "}
                {option.availableQuantity} {option.canonicalUnitSymbol}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm font-medium">
          Quantity
          <input
            className="mt-1 min-h-11 w-full rounded-lg border px-3"
            defaultValue={initial?.line.enteredQuantity ?? ""}
            min="0"
            name="quantity"
            required
            step={requirement?.canonicalUnitDimension === "COUNT" ? "1" : "any"}
            type="number"
          />
        </label>
        <label className="text-sm font-medium">
          Unit
          <select
            className="mt-1 min-h-11 w-full rounded-lg border bg-white px-3"
            defaultValue={initial?.line.enteredUnitId ?? requirement?.canonicalUnitId ?? ""}
            name="unitId"
            required
          >
            <option value="">Select</option>
            {compatibleUnits.map((unit) => (
              <option key={unit.id} value={unit.id}>
                {unit.code}
              </option>
            ))}
          </select>
        </label>
        {type === "RETURN" && (
          <label className="text-sm font-medium">
            Return destination
            <select
              className="mt-1 min-h-11 w-full rounded-lg border bg-white px-3"
              defaultValue={initial?.line.destinationWarehouseId ?? view.packagingWarehouseId}
              name="destinationWarehouseId"
              required
            >
              {warehouses.map((warehouse) => (
                <option key={warehouse.id} value={warehouse.id}>
                  {warehouse.code} - {warehouse.name}
                </option>
              ))}
            </select>
          </label>
        )}
        {type === "DAMAGE" && (
          <label className="text-sm font-medium">
            Damage reason
            <select
              className="mt-1 min-h-11 w-full rounded-lg border bg-white px-3"
              defaultValue={initial?.damageReason ?? ""}
              name="damageReason"
              required
            >
              <option value="">Select reason</option>
              {PACKAGING_DAMAGE_REASONS.map((reason) => (
                <option key={reason} value={reason}>
                  {reason.replaceAll("_", " ")}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      {requirement && (
        <div className="grid gap-3 rounded-lg bg-[var(--surface)] p-4 text-sm md:grid-cols-5">
          <Field label="BOM basis" value={requirement.usageBasis.replaceAll("_", " ")} />
          <Field
            label="Standard"
            value={`${requirement.standardRequiredQuantity} ${requirement.canonicalUnitSymbol}`}
          />
          <Field
            label="Recommended"
            value={`${requirement.recommendedIssueQuantity} ${requirement.canonicalUnitSymbol}`}
          />
          <Field
            label={type === "ISSUE" ? "Already issued" : "Currently held"}
            value={`${type === "ISSUE" ? requirement.cumulativeIssued : requirement.currentlyInProduction} ${requirement.canonicalUnitSymbol}`}
          />
          <Field
            label="Remaining standard"
            value={`${requirement.remainingPlannedQuantity} ${requirement.canonicalUnitSymbol}`}
          />
        </div>
      )}
      {type === "ISSUE" && requirement && (
        <p className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
          Additional issues are allowed. Quantities above the remaining planned standard are
          disclosed in provisional variance and still require AVAILABLE stock.
        </p>
      )}
      {lot && (
        <p className="text-sm">
          Selected lot: {lot.supplierName}; supplier lot {lot.supplierLotNumber ?? "not supplied"};
          GRN {lot.goodsReceiptNumber}; eligible {lot.availableQuantity} {lot.canonicalUnitSymbol};
          manufacture {lot.manufacturingDate?.toLocaleDateString() ?? "not recorded"}; expiry{" "}
          {lot.expiryDate?.toLocaleDateString() ?? "not recorded"}.
        </p>
      )}
      <label className="block text-sm font-medium">
        {type === "DAMAGE" ? "Damage notes" : "Notes"}
        <textarea
          className="mt-1 min-h-20 w-full rounded-lg border px-3 py-2"
          defaultValue={initial?.notes ?? ""}
          maxLength={1000}
          name="notes"
          required={type === "DAMAGE"}
        />
      </label>
      <div className="flex items-center gap-3">
        <button
          className="rounded-lg bg-[var(--accent)] px-5 py-3 text-sm font-semibold text-white disabled:opacity-60"
          disabled={pending || !lotId}
        >
          {pending ? "Saving..." : initial ? "Save DRAFT" : `Create ${type} DRAFT`}
        </button>
        {state.message && (
          <p className="text-sm" role="status">
            {state.message}
          </p>
        )}
      </div>
      <p className="text-xs text-[var(--muted)]">
        DRAFT creates no stock movement. Exact lot stock and batch custody are rechecked when
        posted.
      </p>
    </form>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span className="block text-xs uppercase tracking-wide text-[var(--muted)]">{label}</span>
      <strong className="mt-1 block text-sm">{value}</strong>
    </div>
  );
}
function dateTimeLocal(value?: Date) {
  const date = value ?? new Date();
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}
