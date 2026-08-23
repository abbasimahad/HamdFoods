"use client";

import { useActionState } from "react";
import type { ProductionActionState } from "./action-state";
import type { BatchWarehouseOption } from "@/modules/production/application/batch-contracts";
import type { RecipeUnit } from "@/modules/production/application/contracts";
import {
  PRODUCTION_LOSS_NATURES,
  PRODUCTION_LOSS_REASONS,
  type OutputTransactionRecord,
  type ProductionOutputType,
  type ProductionOutputView,
} from "@/modules/production/application/output-contracts";

export function OutputTransactionForm({
  action,
  view,
  type,
  units,
  warehouses,
  initial,
}: {
  action: (state: ProductionActionState, data: FormData) => Promise<ProductionActionState>;
  view: ProductionOutputView;
  type: ProductionOutputType;
  units: readonly RecipeUnit[];
  warehouses: readonly BatchWarehouseOption[];
  initial?: OutputTransactionRecord;
}) {
  const [state, formAction, pending] = useActionState(action, { ok: false, message: "" });
  const contentUnits = units.filter((unit) => unit.dimension === view.productContentDimension);
  const today = new Date().toISOString().slice(0, 10);
  return (
    <form action={formAction} className="space-y-5">
      {initial && <input name="id" type="hidden" value={initial.id} />}
      <input name="productionBatchId" type="hidden" value={view.productionBatchId} />
      <input name="outputType" type="hidden" value={type} />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Field label="Output type" value={type.replaceAll("_", " ")} />
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
          Production date
          <input
            className="mt-1 min-h-11 w-full rounded-lg border px-3"
            defaultValue={dateOnly(initial?.productionDate) ?? today}
            name="productionDate"
            required
            type="date"
          />
        </label>
        <label className="text-sm font-medium">
          Expiry date
          <input
            className="mt-1 min-h-11 w-full rounded-lg border px-3"
            defaultValue={dateOnly(initial?.expiryDate)}
            name="expiryDate"
            type="date"
          />
        </label>
        {type === "GOOD" ? (
          <>
            <label className="text-sm font-medium">
              Cartons
              <input
                className="mt-1 min-h-11 w-full rounded-lg border px-3"
                defaultValue={initial?.cartons ?? "0"}
                min="0"
                name="cartons"
                required
                step="1"
                type="number"
              />
            </label>
            <label className="text-sm font-medium">
              Loose pieces
              <input
                className="mt-1 min-h-11 w-full rounded-lg border px-3"
                defaultValue={initial?.loosePieces ?? "0"}
                min="0"
                name="loosePieces"
                required
                step="1"
                type="number"
              />
            </label>
            <input
              name="destinationWarehouseId"
              type="hidden"
              value={view.destinationWarehouseId}
            />
            <Field label="AVAILABLE destination" value={view.destinationWarehouseName} />
          </>
        ) : (
          <>
            <label className="text-sm font-medium">
              Quantity
              <input
                className="mt-1 min-h-11 w-full rounded-lg border px-3"
                defaultValue={initial?.enteredQuantity ?? ""}
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
                defaultValue={initial?.enteredUnitId ?? view.productContentUnitId}
                name="unitId"
                required
              >
                {contentUnits.map((unit) => (
                  <option key={unit.id} value={unit.id}>
                    {unit.code}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm font-medium">
              Physical location
              <select
                className="mt-1 min-h-11 w-full rounded-lg border bg-white px-3"
                defaultValue={initial?.destinationWarehouseId ?? view.destinationWarehouseId}
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
          </>
        )}
        {type === "PROCESS_LOSS" && (
          <>
            <label className="text-sm font-medium">
              Loss classification
              <select
                className="mt-1 min-h-11 w-full rounded-lg border bg-white px-3"
                defaultValue={initial?.lossReason ?? ""}
                name="lossReason"
                required
              >
                <option value="">Select</option>
                {PRODUCTION_LOSS_REASONS.map((reason) => (
                  <option key={reason} value={reason}>
                    {reason.replaceAll("_", " ")}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm font-medium">
              Loss nature
              <select
                className="mt-1 min-h-11 w-full rounded-lg border bg-white px-3"
                defaultValue={initial?.lossNature ?? ""}
                name="lossNature"
                required
              >
                <option value="">Select</option>
                {PRODUCTION_LOSS_NATURES.map((nature) => (
                  <option key={nature} value={nature}>
                    {nature}
                  </option>
                ))}
              </select>
            </label>
          </>
        )}
      </div>
      <div className="rounded-lg bg-[var(--surface)] p-4 text-sm">
        {type === "GOOD"
          ? `${view.piecesPerCarton} pieces per carton. Only normalized total PCS enters AVAILABLE.`
          : `${type.replaceAll("_", " ")} uses the ${view.productContentDimension} product-content basis (${view.productContentUnitSymbol}). ${type === "PROCESS_LOSS" ? "It creates no positive inventory." : type === "REPROCESS" ? "It enters REPROCESS, never AVAILABLE." : "It enters SCRAP, never AVAILABLE."}`}
      </div>
      <label className="block text-sm font-medium">
        {type === "GOOD" ? "Notes" : "Reason / notes"}
        <textarea
          className="mt-1 min-h-20 w-full rounded-lg border px-3 py-2"
          defaultValue={initial?.notes ?? ""}
          maxLength={1000}
          name="notes"
          required={type !== "GOOD"}
        />
      </label>
      <div className="flex items-center gap-3">
        <button
          className="rounded-lg bg-[var(--accent)] px-5 py-3 text-sm font-semibold text-white disabled:opacity-60"
          disabled={pending}
        >
          {pending
            ? "Saving..."
            : initial
              ? "Save DRAFT"
              : `Create ${type.replaceAll("_", " ")} DRAFT`}
        </button>
        {state.message && (
          <p className="text-sm" role="status">
            {state.message}
          </p>
        )}
      </div>
      <p className="text-xs text-[var(--muted)]">
        DRAFT creates no inventory or loss effect. Posting creates or reuses the batch production
        lot atomically.
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
function dateOnly(value?: Date | null) {
  return value ? value.toISOString().slice(0, 10) : undefined;
}
function dateTimeLocal(value?: Date) {
  const date = value ?? new Date();
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}
