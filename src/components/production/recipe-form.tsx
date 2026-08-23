"use client";

import { useActionState, useState } from "react";
import type {
  RecipeItemOption,
  RecipeRecord,
  RecipeUnit,
} from "@/modules/production/application/contracts";
import { PACKAGING_USAGE_BASES } from "@/modules/production/application/contracts";
import { initialProductionActionState, type ProductionAction } from "./action-state";

type Ingredient = {
  itemId: string;
  quantity: string;
  unitId: string;
  allowancePercent: string;
  processNotes: string;
};
type PackagingLine = {
  itemId: string;
  usageBasis: "PER_PIECE" | "PER_CARTON";
  quantity: string;
  unitId: string;
  allowancePercent: string;
  notes: string;
};
const ingredient = (): Ingredient => ({
  itemId: "",
  quantity: "",
  unitId: "",
  allowancePercent: "0",
  processNotes: "",
});
const packaging = (): PackagingLine => ({
  itemId: "",
  usageBasis: "PER_PIECE",
  quantity: "",
  unitId: "",
  allowancePercent: "0",
  notes: "",
});

export function RecipeForm({
  action,
  items,
  units,
  initial,
}: {
  action: ProductionAction;
  items: readonly RecipeItemOption[];
  units: readonly RecipeUnit[];
  initial?: RecipeRecord;
}) {
  const [state, formAction, pending] = useActionState(action, initialProductionActionState);
  const [ingredients, setIngredients] = useState<Ingredient[]>(
    initial?.ingredients.map((line) => ({
      itemId: line.itemId,
      quantity: line.enteredQuantity,
      unitId: line.enteredUnitId,
      allowancePercent: line.allowancePercent,
      processNotes: line.processNotes ?? "",
    })) ?? [ingredient()],
  );
  const [packagingLines, setPackagingLines] = useState<PackagingLine[]>(
    initial?.packagingLines.map((line) => ({
      itemId: line.itemId,
      usageBasis: line.usageBasis,
      quantity: line.enteredQuantity,
      unitId: line.enteredUnitId,
      allowancePercent: line.allowancePercent,
      notes: line.notes ?? "",
    })) ?? [],
  );
  const finishedGoods = items.filter((item) => item.itemType === "FINISHED_GOOD");
  const rawMaterials = items.filter((item) => item.itemType === "RAW_MATERIAL");
  const packagingMaterials = items.filter((item) => item.itemType === "PACKAGING_MATERIAL");
  return (
    <form action={formAction} className="space-y-6">
      {initial && <input name="id" type="hidden" value={initial.id} />}
      <input name="ingredientsJson" type="hidden" value={JSON.stringify(ingredients)} />
      <input name="packagingLinesJson" type="hidden" value={JSON.stringify(packagingLines)} />
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <Field
          defaultValue={initial?.code ?? ""}
          label="Recipe code"
          name="code"
          placeholder="RCP-KETCHUP-001"
          required
        />
        <Field defaultValue={initial?.name ?? ""} label="Recipe name" name="name" required />
        <Select
          label="Finished good"
          name="finishedGoodId"
          defaultValue={initial?.finishedGoodId ?? ""}
          options={finishedGoods.map((item) => ({
            value: item.id,
            label: `${item.code} - ${item.name}`,
          }))}
        />
        <Field
          defaultValue={initial?.effectiveDate ? dateOnly(initial.effectiveDate) : ""}
          label="Effective date"
          name="effectiveDate"
          type="date"
        />
        <Field
          defaultValue={initial?.standardBatchEnteredQuantity ?? ""}
          label="Standard batch"
          name="standardBatchQuantity"
          required
          type="number"
        />
        <Select
          label="Batch unit"
          name="standardBatchUnitId"
          defaultValue={initial?.standardBatchUnitId ?? ""}
          options={units.map((unit) => ({
            value: unit.id,
            label: `${unit.code} (${unit.dimension})`,
          }))}
        />
        <Field
          defaultValue={initial?.expectedOutputEnteredQuantity ?? ""}
          label="Expected output"
          name="expectedOutputQuantity"
          type="number"
        />
        <Select
          label="Output unit"
          name="expectedOutputUnitId"
          required={false}
          defaultValue={initial?.expectedOutputUnitId ?? ""}
          options={units.map((unit) => ({
            value: unit.id,
            label: `${unit.code} (${unit.dimension})`,
          }))}
        />
        <label className="text-sm font-medium md:col-span-2 xl:col-span-4">
          Notes
          <textarea
            className="mt-1 min-h-20 w-full rounded-lg border px-3 py-2"
            defaultValue={initial?.notes ?? ""}
            name="notes"
          />
        </label>
      </div>
      <LineTable
        title="Recipe ingredients"
        headers={["Raw material", "Quantity", "Unit", "Allowance %", "Process notes"]}
        addLabel="Add ingredient"
        onAdd={() => setIngredients((current) => [...current, ingredient()])}
      >
        {ingredients.map((line, index) => {
          const item = rawMaterials.find((candidate) => candidate.id === line.itemId);
          const compatible = item
            ? units.filter((unit) => unit.dimension === item.stockUnitDimension)
            : [];
          return (
            <tr key={index}>
              <SelectCell
                value={line.itemId}
                onChange={(value) => update(setIngredients, index, { itemId: value, unitId: "" })}
                options={rawMaterials.map((candidate) => ({
                  value: candidate.id,
                  label: `${candidate.code} - ${candidate.name}`,
                }))}
              />
              <InputCell
                value={line.quantity}
                onChange={(value) => update(setIngredients, index, { quantity: value })}
                number
              />
              <SelectCell
                value={line.unitId}
                onChange={(value) => update(setIngredients, index, { unitId: value })}
                options={compatible.map((unit) => ({ value: unit.id, label: unit.code }))}
              />
              <InputCell
                value={line.allowancePercent}
                onChange={(value) => update(setIngredients, index, { allowancePercent: value })}
                number
              />
              <InputCell
                value={line.processNotes}
                onChange={(value) => update(setIngredients, index, { processNotes: value })}
              />
              <Remove
                disabled={ingredients.length === 1}
                onClick={() =>
                  setIngredients((current) => current.filter((_, position) => position !== index))
                }
              />
            </tr>
          );
        })}
      </LineTable>
      <LineTable
        title="Packaging BOM"
        headers={[
          "Packaging material",
          "Usage basis",
          "Quantity / basis",
          "Unit",
          "Allowance %",
          "Notes",
        ]}
        addLabel="Add packaging line"
        onAdd={() => setPackagingLines((current) => [...current, packaging()])}
      >
        {packagingLines.map((line, index) => {
          const item = packagingMaterials.find((candidate) => candidate.id === line.itemId);
          const compatible = item
            ? units.filter((unit) => unit.dimension === item.stockUnitDimension)
            : [];
          return (
            <tr key={index}>
              <SelectCell
                value={line.itemId}
                onChange={(value) =>
                  update(setPackagingLines, index, { itemId: value, unitId: "" })
                }
                options={packagingMaterials.map((candidate) => ({
                  value: candidate.id,
                  label: `${candidate.code} - ${candidate.name}`,
                }))}
              />
              <SelectCell
                value={line.usageBasis}
                onChange={(value) =>
                  update(setPackagingLines, index, {
                    usageBasis: value as PackagingLine["usageBasis"],
                  })
                }
                options={PACKAGING_USAGE_BASES.map((basis) => ({
                  value: basis,
                  label: basis.replaceAll("_", " "),
                }))}
              />
              <InputCell
                value={line.quantity}
                onChange={(value) => update(setPackagingLines, index, { quantity: value })}
                number
              />
              <SelectCell
                value={line.unitId}
                onChange={(value) => update(setPackagingLines, index, { unitId: value })}
                options={compatible.map((unit) => ({ value: unit.id, label: unit.code }))}
              />
              <InputCell
                value={line.allowancePercent}
                onChange={(value) => update(setPackagingLines, index, { allowancePercent: value })}
                number
              />
              <InputCell
                value={line.notes}
                onChange={(value) => update(setPackagingLines, index, { notes: value })}
              />
              <Remove
                disabled={false}
                onClick={() =>
                  setPackagingLines((current) =>
                    current.filter((_, position) => position !== index),
                  )
                }
              />
            </tr>
          );
        })}
      </LineTable>
      <div className="flex items-center gap-3">
        <button
          className="min-h-11 rounded-lg bg-[var(--accent)] px-5 font-semibold text-white disabled:opacity-60"
          disabled={pending}
        >
          {pending ? "Saving..." : initial ? "Save draft" : "Create draft recipe"}
        </button>
        {state.message && (
          <p className="text-sm" role="status">
            {state.message}
          </p>
        )}
      </div>
      <p className="text-xs text-[var(--muted)]">
        The server normalizes every quantity and allowance. Recipe changes never post inventory.
      </p>
    </form>
  );
}
function update<T>(
  setter: React.Dispatch<React.SetStateAction<T[]>>,
  index: number,
  patch: Partial<T>,
) {
  setter((current) =>
    current.map((line, position) => (position === index ? { ...line, ...patch } : line)),
  );
}
function Field({
  label,
  name,
  defaultValue,
  type = "text",
  required = false,
  placeholder,
}: {
  label: string;
  name: string;
  defaultValue: string;
  type?: string;
  required?: boolean;
  placeholder?: string;
}) {
  return (
    <label className="text-sm font-medium">
      {label}
      <input
        className="mt-1 min-h-11 w-full rounded-lg border px-3"
        defaultValue={defaultValue}
        min={type === "number" ? 0 : undefined}
        name={name}
        placeholder={placeholder}
        required={required}
        step={type === "number" ? "any" : undefined}
        type={type}
      />
    </label>
  );
}
function Select({
  label,
  name,
  defaultValue,
  options,
  required = true,
}: {
  label: string;
  name: string;
  defaultValue: string;
  options: readonly { value: string; label: string }[];
  required?: boolean;
}) {
  return (
    <label className="text-sm font-medium">
      {label}
      <select
        className="mt-1 min-h-11 w-full rounded-lg border bg-white px-3"
        defaultValue={defaultValue}
        name={name}
        required={required}
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
function LineTable({
  title,
  headers,
  addLabel,
  onAdd,
  children,
}: {
  title: string;
  headers: readonly string[];
  addLabel: string;
  onAdd(): void;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div className="mb-2 flex items-center justify-between">
        <h2 className="font-semibold">{title}</h2>
        <button
          className="rounded-lg border px-3 py-2 text-sm font-semibold"
          onClick={onAdd}
          type="button"
        >
          {addLabel}
        </button>
      </div>
      <div className="overflow-x-auto rounded-xl border">
        <table className="w-full min-w-[72rem] text-left text-sm">
          <thead className="bg-[var(--surface)]">
            <tr>
              {headers.map((header) => (
                <th className="p-3" key={header}>
                  {header}
                </th>
              ))}
              <th />
            </tr>
          </thead>
          <tbody className="divide-y">{children}</tbody>
        </table>
      </div>
    </section>
  );
}
function SelectCell({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange(value: string): void;
  options: readonly { value: string; label: string }[];
}) {
  return (
    <td className="p-2">
      <select
        className="min-h-10 w-56 rounded-lg border bg-white px-2"
        onChange={(event) => onChange(event.target.value)}
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
    </td>
  );
}
function InputCell({
  value,
  onChange,
  number = false,
}: {
  value: string;
  onChange(value: string): void;
  number?: boolean;
}) {
  return (
    <td className="p-2">
      <input
        className="min-h-10 w-36 rounded-lg border px-2"
        min={number ? 0 : undefined}
        onChange={(event) => onChange(event.target.value)}
        required={number}
        step={number ? "any" : undefined}
        type={number ? "number" : "text"}
        value={value}
      />
    </td>
  );
}
function Remove({ disabled, onClick }: { disabled: boolean; onClick(): void }) {
  return (
    <td className="p-2">
      <button
        className="text-xs text-red-700 disabled:opacity-40"
        disabled={disabled}
        onClick={onClick}
        type="button"
      >
        Remove
      </button>
    </td>
  );
}
function dateOnly(value: Date) {
  return new Date(value).toISOString().slice(0, 10);
}
