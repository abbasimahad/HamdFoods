"use client";

import { useActionState, useMemo, useState } from "react";
import type { ProductionActionState } from "./action-state";
import type {
  BatchMaterialView,
  MaterialTransactionRecord,
  MaterialTransactionType,
} from "@/modules/production/application/material-contracts";
import type { BatchWarehouseOption } from "@/modules/production/application/batch-contracts";
import type { RecipeUnit } from "@/modules/production/application/contracts";

export function MaterialTransactionForm({
  action,
  view,
  type,
  units,
  warehouses,
  initial,
}: {
  action: (state: ProductionActionState, data: FormData) => Promise<ProductionActionState>;
  view: BatchMaterialView;
  type: MaterialTransactionType;
  units: readonly RecipeUnit[];
  warehouses: readonly BatchWarehouseOption[];
  initial?: MaterialTransactionRecord;
}) {
  const [state, formAction, pending] = useActionState(action, { ok: false, message: "" });
  const [requirementId, setRequirementId] = useState(
    initial?.line.batchRequirementId ?? view.requirements[0]?.requirementId ?? "",
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
        <Field label="Transaction type" value={type} />
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
          Raw-material requirement
          <select
            className="mt-1 min-h-11 w-full rounded-lg border bg-white px-3"
            name="batchRequirementId"
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
        <Field label="Custody/source warehouse" value={view.rawMaterialWarehouseName} />
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
                {option.availableQuantity} {option.canonicalUnitSymbol} available
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
            step="any"
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
              defaultValue={initial?.line.destinationWarehouseId ?? view.rawMaterialWarehouseId}
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
      </div>
      {requirement && (
        <div className="grid gap-3 rounded-lg bg-[var(--surface)] p-4 text-sm md:grid-cols-4">
          <Field
            label="Planned"
            value={`${requirement.plannedQuantity} ${requirement.canonicalUnitSymbol}`}
          />
          <Field
            label="Recommended issue"
            value={`${requirement.recommendedIssueQuantity} ${requirement.canonicalUnitSymbol}`}
          />
          <Field
            label={type === "ISSUE" ? "Already issued" : "Currently held"}
            value={`${type === "ISSUE" ? requirement.cumulativeIssued : requirement.currentlyInProduction} ${requirement.canonicalUnitSymbol}`}
          />
          <Field
            label="Remaining planned"
            value={`${requirement.remainingPlannedQuantity} ${requirement.canonicalUnitSymbol}`}
          />
        </div>
      )}
      {type === "ISSUE" && requirement && (
        <p className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
          Additional issues are allowed, but any quantity above the remaining planned requirement is
          over plan and remains visible in actual-usage reconciliation.
        </p>
      )}
      {lot && (
        <p className="text-sm">
          Selected lot: {lot.supplierName}; supplier lot {lot.supplierLotNumber ?? "not supplied"};
          GRN {lot.goodsReceiptNumber}; available {lot.availableQuantity} {lot.canonicalUnitSymbol};
          expiry {lot.expiryDate?.toLocaleDateString() ?? "not recorded"}.
        </p>
      )}
      <label className="block text-sm font-medium">
        Notes / reason
        <textarea
          className="mt-1 min-h-20 w-full rounded-lg border px-3 py-2"
          defaultValue={initial?.notes ?? ""}
          maxLength={1000}
          name="notes"
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
        Saving a DRAFT creates no inventory movement. Stock is rechecked only when the draft is
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
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}
