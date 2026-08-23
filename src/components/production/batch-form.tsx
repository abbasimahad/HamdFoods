"use client";

import { useActionState, useState } from "react";
import type { ProductionActionState } from "./action-state";
import type {
  BatchRecipeOption,
  BatchWarehouseOption,
  ProductionBatchRecord,
} from "@/modules/production/application/batch-contracts";
import type { RecipeUnit } from "@/modules/production/application/contracts";

export function ProductionBatchForm({
  action,
  recipes,
  units,
  warehouses,
  initial,
}: {
  action: (state: ProductionActionState, data: FormData) => Promise<ProductionActionState>;
  recipes: readonly BatchRecipeOption[];
  units: readonly RecipeUnit[];
  warehouses: readonly BatchWarehouseOption[];
  initial?: ProductionBatchRecord;
}) {
  const [state, formAction, pending] = useActionState(action, { ok: false, message: "" });
  const [recipeId, setRecipeId] = useState(initial?.recipeId ?? recipes[0]?.id ?? "");
  const [batchUnitId, setBatchUnitId] = useState(
    initial?.plannedBatchUnitId ?? recipes[0]?.standardBatchUnitId ?? "",
  );
  const recipe = recipes.find((candidate) => candidate.id === recipeId);
  const compatibleUnits = units.filter(
    (unit) => unit.dimension === (recipe?.standardBatchDimension ?? initial?.plannedBatchDimension),
  );
  return (
    <form action={formAction} className="space-y-6">
      {initial && <input name="id" type="hidden" value={initial.id} />}
      <section>
        <h2 className="font-semibold">General</h2>
        <div className="mt-3 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <Select
            label="Approved recipe"
            name="recipeId"
            value={recipeId}
            onChange={(value) => {
              setRecipeId(value);
              setBatchUnitId(
                recipes.find((candidate) => candidate.id === value)?.standardBatchUnitId ?? "",
              );
            }}
            options={recipes.map((option) => ({
              value: option.id,
              label: `${option.finishedGoodCode} - ${option.finishedGoodName} / ${option.code} v${option.version}`,
            }))}
          />
          <Field
            label="Production date"
            name="plannedProductionDate"
            type="date"
            defaultValue={dateOnly(initial?.plannedProductionDate) ?? today()}
            required
          />
          <Field
            label="Target completion"
            name="targetCompletionDate"
            type="date"
            defaultValue={dateOnly(initial?.targetCompletionDate) ?? ""}
          />
          <Select
            label="Raw-material warehouse"
            name="rawMaterialWarehouseId"
            defaultValue={initial?.rawMaterialWarehouseId ?? warehouses[0]?.id ?? ""}
            options={warehouseOptions(warehouses)}
          />
          <Select
            label="Packaging warehouse"
            name="packagingWarehouseId"
            defaultValue={initial?.packagingWarehouseId ?? warehouses[0]?.id ?? ""}
            options={warehouseOptions(warehouses)}
          />
          <Select
            label="Finished-goods destination"
            name="finishedGoodsDestinationWarehouseId"
            defaultValue={initial?.finishedGoodsDestinationWarehouseId ?? warehouses[0]?.id ?? ""}
            options={warehouseOptions(warehouses)}
          />
        </div>
      </section>
      <section>
        <h2 className="font-semibold">Batch size and planned output</h2>
        <div className="mt-3 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <Field
            label="Planned batch quantity"
            name="plannedBatchQuantity"
            type="number"
            defaultValue={
              initial?.plannedBatchEnteredQuantity ?? recipe?.standardBatchQuantity ?? ""
            }
            required
          />
          <Select
            label="Batch unit"
            name="plannedBatchUnitId"
            value={batchUnitId}
            onChange={setBatchUnitId}
            options={compatibleUnits.map((unit) => ({
              value: unit.id,
              label: `${unit.code} (${unit.dimension})`,
            }))}
          />
          <Field
            label="Planned cartons"
            name="plannedCartons"
            type="number"
            defaultValue={initial?.plannedCartons ?? "0"}
            required
            integer
          />
          <Field
            label="Planned loose pieces"
            name="plannedLoosePieces"
            type="number"
            defaultValue={initial?.plannedLoosePieces ?? "0"}
            required
            integer
          />
        </div>
        {recipe && (
          <div className="mt-3 rounded-lg bg-[var(--surface)] p-3 text-sm">
            Standard batch: {recipe.standardBatchQuantity} {recipe.standardBatchUnitSymbol};
            expected output: {recipe.expectedOutputQuantity ?? "not specified"}{" "}
            {recipe.expectedOutputUnitSymbol}; packing profile: {recipe.piecesPerCarton}{" "}
            pieces/carton.
          </div>
        )}
      </section>
      <label className="block text-sm font-medium">
        Notes
        <textarea
          className="mt-1 min-h-24 w-full rounded-lg border px-3 py-2"
          defaultValue={initial?.notes ?? ""}
          name="notes"
        />
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <button
          className="min-h-11 rounded-lg bg-[var(--accent)] px-5 font-semibold text-white disabled:opacity-60"
          disabled={pending || !recipeId}
        >
          {pending
            ? "Calculating and saving..."
            : initial
              ? "Recalculate and save DRAFT"
              : "Create DRAFT batch"}
        </button>
        {state.message && (
          <p className="text-sm" role="status">
            {state.message}
          </p>
        )}
      </div>
      <p className="text-xs text-[var(--muted)]">
        The server scales the approved recipe, snapshots requirements, and checks current stock.
        Saving does not reserve or move inventory.
      </p>
    </form>
  );
}

function Field({
  label,
  name,
  type,
  defaultValue,
  required = false,
  integer = false,
}: {
  label: string;
  name: string;
  type: string;
  defaultValue: string;
  required?: boolean;
  integer?: boolean;
}) {
  return (
    <label className="text-sm font-medium">
      {label}
      <input
        className="mt-1 min-h-11 w-full rounded-lg border px-3"
        defaultValue={defaultValue}
        min={type === "number" ? "0" : undefined}
        name={name}
        required={required}
        step={type === "number" ? (integer ? "1" : "any") : undefined}
        type={type}
      />
    </label>
  );
}

function Select({
  label,
  name,
  options,
  defaultValue,
  value,
  onChange,
}: {
  label: string;
  name: string;
  options: readonly { value: string; label: string }[];
  defaultValue?: string;
  value?: string;
  onChange?(value: string): void;
}) {
  return (
    <label className="text-sm font-medium">
      {label}
      <select
        className="mt-1 min-h-11 w-full rounded-lg border bg-white px-3"
        defaultValue={value === undefined ? defaultValue : undefined}
        name={name}
        onChange={onChange ? (event) => onChange(event.target.value) : undefined}
        required
        value={value}
      >
        <option value="">Select</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function warehouseOptions(warehouses: readonly BatchWarehouseOption[]) {
  return warehouses.map((warehouse) => ({
    value: warehouse.id,
    label: `${warehouse.code} - ${warehouse.name}`,
  }));
}

function dateOnly(value?: Date | null) {
  return value ? value.toISOString().slice(0, 10) : undefined;
}

function today() {
  return new Date().toISOString().slice(0, 10);
}
