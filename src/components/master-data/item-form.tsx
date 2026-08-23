"use client";

import { useActionState } from "react";

import type {
  CategoryRecord,
  ItemRecord,
  UnitRecord,
} from "@/modules/master-data/application/contracts";
import { PACKAGING_KINDS, type ItemType } from "@/modules/master-data/domain/master-data";

import { initialMasterActionState, type MasterAction } from "./action-state";

export function ItemForm({
  action,
  itemType,
  categories,
  units,
  contentUnits,
  initial,
}: {
  action: MasterAction;
  itemType: ItemType;
  categories: readonly CategoryRecord[];
  units: readonly UnitRecord[];
  contentUnits: readonly UnitRecord[];
  initial?: ItemRecord;
}) {
  const [state, formAction, pending] = useActionState(action, initialMasterActionState);
  return (
    <form action={formAction} className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
      {initial && <input name="id" type="hidden" value={initial.id} />}
      <TextField defaultValue={initial?.code} label="Item code" name="code" />
      <TextField defaultValue={initial?.name} label="Name" name="name" />
      <SelectField
        defaultValue={initial?.categoryId}
        label="Category"
        name="categoryId"
        options={categories.map((category) => ({ value: category.id, label: category.name }))}
      />
      <SelectField
        defaultValue={initial?.stockUnitId}
        label="Stock unit"
        name="stockUnitId"
        options={units.map((unit) => ({ value: unit.id, label: `${unit.name} (${unit.symbol})` }))}
      />
      {itemType === "PACKAGING_MATERIAL" && (
        <SelectField
          defaultValue={initial?.packagingKind ?? undefined}
          label="Packaging kind"
          name="packagingKind"
          options={PACKAGING_KINDS.map((kind) => ({
            value: kind,
            label: kind.replaceAll("_", " "),
          }))}
        />
      )}
      {itemType === "FINISHED_GOOD" && (
        <>
          <TextField
            defaultValue={initial?.finishedGoodProfile?.netContentQuantity}
            inputMode="decimal"
            label="Net content"
            name="netContentQuantity"
          />
          <SelectField
            defaultValue={initial?.finishedGoodProfile?.netContentUnitId}
            label="Content unit"
            name="netContentUnitId"
            options={contentUnits.map((unit) => ({
              value: unit.id,
              label: `${unit.name} (${unit.symbol})`,
            }))}
          />
          <TextField
            defaultValue={
              initial?.finishedGoodProfile?.piecesPerCarton
                ? String(initial.finishedGoodProfile.piecesPerCarton)
                : undefined
            }
            inputMode="numeric"
            label="Pieces per carton"
            name="piecesPerCarton"
          />
        </>
      )}
      <label className="text-sm font-medium md:col-span-2 xl:col-span-4">
        Description
        <textarea
          className="mt-1 min-h-24 w-full rounded-lg border border-[var(--border)] px-3 py-2"
          defaultValue={initial?.description ?? ""}
          maxLength={2000}
          name="description"
        />
      </label>
      <div className="flex items-center gap-3 md:col-span-2 xl:col-span-4">
        <button
          className="min-h-11 rounded-lg bg-[var(--accent)] px-4 text-sm font-semibold text-white disabled:opacity-60"
          disabled={
            pending ||
            categories.length === 0 ||
            units.length === 0 ||
            (itemType === "FINISHED_GOOD" && contentUnits.length === 0)
          }
          type="submit"
        >
          {pending ? "Saving…" : initial ? "Save item" : "Create item"}
        </button>
        {state.message && (
          <p className="text-sm" role="status">
            {state.message}
          </p>
        )}
      </div>
    </form>
  );
}

function TextField({
  label,
  name,
  defaultValue,
  inputMode,
}: {
  label: string;
  name: string;
  defaultValue?: string | undefined;
  inputMode?: "decimal" | "numeric" | undefined;
}) {
  return (
    <label className="text-sm font-medium">
      {label}
      <input
        className="mt-1 min-h-11 w-full rounded-lg border border-[var(--border)] px-3"
        defaultValue={defaultValue}
        inputMode={inputMode}
        name={name}
        required
      />
    </label>
  );
}

function SelectField({
  label,
  name,
  defaultValue,
  options,
}: {
  label: string;
  name: string;
  defaultValue?: string | undefined;
  options: readonly { value: string; label: string }[];
}) {
  return (
    <label className="text-sm font-medium">
      {label}
      <select
        className="mt-1 min-h-11 w-full rounded-lg border border-[var(--border)] bg-white px-3"
        defaultValue={defaultValue}
        name={name}
        required
      >
        <option disabled value="">
          Select…
        </option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}
