"use client";

import { useActionState, useMemo, useState } from "react";

import { SearchableSelect } from "@/components/ui/searchable-select";
import { SingleFlightForm } from "@/components/ui/single-flight-form";
import { initialProductionActionState, type ProductionAction } from "./action-state";

type Source = {
  productionLotId: string;
  lotNumber: string;
  itemId: string;
  itemCode: string;
  itemName: string;
  warehouseId: string;
  warehouseCode: string;
  unitId: string;
  unitSymbol: string;
  quantity: string;
  expiryDate: Date | null;
  shelfLifeDays: number | null;
};
type Recipe = {
  id: string;
  code: string;
  version: number;
  finishedGoodId: string;
  finishedGoodCode: string;
  standardBatchQuantity: string;
  standardBatchUnitId: string;
};

export function ReprocessForm({
  action,
  sources,
  recipes,
  warehouses,
}: {
  action: ProductionAction;
  sources: readonly Source[];
  recipes: readonly Recipe[];
  warehouses: readonly { id: string; code: string; name: string }[];
}) {
  const [state, formAction, pending] = useActionState(action, initialProductionActionState);
  const [sourceKey, setSourceKey] = useState(sources[0] ? key(sources[0]) : "");
  const [recipeId, setRecipeId] = useState(
    () => recipes.find((candidate) => candidate.finishedGoodId === sources[0]?.itemId)?.id ?? "",
  );
  const source = sources.find((candidate) => key(candidate) === sourceKey);
  const compatibleRecipes = useMemo(
    () => recipes.filter((recipe) => recipe.finishedGoodId === source?.itemId),
    [recipes, source?.itemId],
  );
  const recipe = compatibleRecipes.find((candidate) => candidate.id === recipeId);
  return (
    <SingleFlightForm action={formAction} className="space-y-6">
      <section>
        <h2 className="font-semibold">Source custody</h2>
        <div className="mt-3 grid gap-4 md:grid-cols-2">
          <SearchableSelect
            label="Finished-good lot in REPROCESS"
            name="sourceDisplay"
            onValueChange={(nextSourceKey) => {
              const nextSource = sources.find((candidate) => key(candidate) === nextSourceKey);
              setSourceKey(nextSourceKey);
              setRecipeId(
                recipes.find((candidate) => candidate.finishedGoodId === nextSource?.itemId)?.id ??
                  "",
              );
            }}
            options={sources.map((option) => ({
              value: key(option),
              label: `${option.itemCode} / ${option.lotNumber} / ${option.quantity} ${option.unitSymbol} / ${option.warehouseCode}`,
              keywords: `${option.itemName} ${option.lotNumber} ${option.warehouseCode}`,
            }))}
            value={sourceKey}
          />
          <Field
            label="Quantity to reprocess"
            name="sourceQuantity"
            key={`source-quantity:${sourceKey}`}
            defaultValue={source?.quantity ?? ""}
            type="number"
          />
        </div>
        {source && (
          <p className="mt-3 rounded-lg bg-[var(--surface)] p-3 text-sm text-[var(--muted)]">
            Expiry {source.expiryDate?.toLocaleDateString() ?? "missing"}; approved reprocess shelf
            life {source.shelfLifeDays ?? "missing"} days. The server rechecks both before saving.
          </p>
        )}
        <input name="sourceProductionLotId" type="hidden" value={source?.productionLotId ?? ""} />
        <input name="sourceWarehouseId" type="hidden" value={source?.warehouseId ?? ""} />
        <input name="sourceUnitId" type="hidden" value={source?.unitId ?? ""} />
      </section>
      <section>
        <h2 className="font-semibold">Linked production plan</h2>
        <div className="mt-3 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <label className="text-sm font-medium">
            Approved recipe
            <select
              className="mt-1 min-h-11 w-full rounded-lg border bg-white px-3"
              name="recipeId"
              onChange={(event) => setRecipeId(event.target.value)}
              required
              value={recipeId}
            >
              {compatibleRecipes.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.code} v{option.version}
                </option>
              ))}
            </select>
          </label>
          <Field
            label="Planned batch quantity"
            name="plannedBatchQuantity"
            key={`quantity:${recipe?.id ?? "none"}`}
            defaultValue={recipe?.standardBatchQuantity ?? ""}
            type="number"
          />
          <input
            name="plannedBatchUnitId"
            type="hidden"
            value={recipe?.standardBatchUnitId ?? ""}
          />
          <Field
            label="Production date"
            name="plannedProductionDate"
            defaultValue={today()}
            type="date"
          />
          <Field
            label="Target completion"
            name="targetCompletionDate"
            defaultValue=""
            type="date"
            required={false}
          />
          <Warehouse
            label="Raw-material warehouse"
            name="rawMaterialWarehouseId"
            warehouses={warehouses}
          />
          <Warehouse
            label="Packaging warehouse"
            name="packagingWarehouseId"
            warehouses={warehouses}
          />
          <Warehouse
            label="Finished-goods destination"
            name="finishedGoodsDestinationWarehouseId"
            warehouses={warehouses}
          />
          <Field label="Planned cartons" name="plannedCartons" defaultValue="0" type="number" />
          <Field
            label="Planned loose pieces"
            name="plannedLoosePieces"
            defaultValue="1"
            type="number"
          />
        </div>
      </section>
      <label className="block text-sm font-medium">
        Reason
        <input
          className="mt-1 min-h-11 w-full rounded-lg border px-3"
          maxLength={1000}
          minLength={3}
          name="reason"
          required
        />
      </label>
      <label className="block text-sm font-medium">
        Notes
        <textarea
          className="mt-1 min-h-24 w-full rounded-lg border px-3 py-2"
          maxLength={3000}
          name="notes"
        />
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <button
          className="min-h-11 rounded-lg bg-[var(--accent)] px-5 font-semibold text-white disabled:opacity-60"
          disabled={pending || !source || !recipe}
        >
          {pending ? "Saving draft..." : "Create Reprocess draft"}
        </button>
        {state.message && (
          <p className="text-sm" role="status">
            {state.message}
          </p>
        )}
      </div>
    </SingleFlightForm>
  );
}

function key(source: Source) {
  return `${source.productionLotId}:${source.warehouseId}:${source.unitId}`;
}
function today() {
  return new Date().toISOString().slice(0, 10);
}
function Field({
  label,
  name,
  defaultValue,
  type,
  required = true,
}: {
  label: string;
  name: string;
  defaultValue: string;
  type: string;
  required?: boolean;
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
        step={type === "number" ? "any" : undefined}
        type={type}
      />
    </label>
  );
}
function Warehouse({
  label,
  name,
  warehouses,
}: {
  label: string;
  name: string;
  warehouses: readonly { id: string; code: string; name: string }[];
}) {
  return (
    <label className="text-sm font-medium">
      {label}
      <select className="mt-1 min-h-11 w-full rounded-lg border bg-white px-3" name={name} required>
        {warehouses.map((warehouse) => (
          <option key={warehouse.id} value={warehouse.id}>
            {warehouse.code} / {warehouse.name}
          </option>
        ))}
      </select>
    </label>
  );
}
