"use client";

import { useActionState } from "react";

import type {
  InventoryItemOption,
  InventoryUnitOption,
  WarehouseRecord,
} from "@/modules/inventory/application/contracts";
import { INVENTORY_STATUSES } from "@/modules/inventory/domain/inventory";

import { initialInventoryActionState, type InventoryAction } from "./action-state";

export function InventoryPostingForm({
  action,
  mode,
  items,
  units,
  warehouses,
}: {
  action: InventoryAction;
  mode: "OPENING_BALANCE" | "ADJUSTMENT_IN" | "ADJUSTMENT_OUT" | "TRANSFER";
  items: readonly InventoryItemOption[];
  units: readonly InventoryUnitOption[];
  warehouses: readonly WarehouseRecord[];
}) {
  const [state, formAction, pending] = useActionState(action, initialInventoryActionState);
  const transfer = mode === "TRANSFER";
  return (
    <form action={formAction} className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
      {!transfer && <input name="movementType" type="hidden" value={mode} />}
      <Select
        label="Item"
        name="itemId"
        options={items.map((item) => ({ value: item.id, label: `${item.code} · ${item.name}` }))}
      />
      {transfer ? (
        <>
          <Select
            label="Source warehouse"
            name="sourceWarehouseId"
            options={warehouseOptions(warehouses)}
          />
          <Select
            label="Destination warehouse"
            name="destinationWarehouseId"
            options={warehouseOptions(warehouses)}
          />
        </>
      ) : (
        <Select label="Warehouse" name="warehouseId" options={warehouseOptions(warehouses)} />
      )}
      <Select
        label="Status"
        name="status"
        options={INVENTORY_STATUSES.map((status) => ({
          value: status,
          label: status.replaceAll("_", " "),
        }))}
      />
      <Field
        label="Quantity"
        name="quantity"
        placeholder="250"
        inputMode="decimal"
        required={false}
      />
      <Select
        label="Quantity unit"
        name="unitId"
        required={false}
        options={units.map((unit) => ({
          value: unit.id,
          label: `${unit.symbol} · ${unit.dimension}`,
        }))}
      />
      <Field
        label="FG cartons"
        name="cartons"
        placeholder="0"
        inputMode="numeric"
        required={false}
      />
      <Field
        label="FG loose pieces"
        name="loosePieces"
        placeholder="0"
        inputMode="numeric"
        required={false}
      />
      <Field
        label="Reference"
        name="referenceId"
        placeholder="Required for transfers"
        required={transfer}
      />
      <Field
        label="Source key (optional)"
        name="sourceKey"
        placeholder="Stable import/event key"
        required={false}
      />
      <label className="text-sm font-medium md:col-span-2">
        Reason
        <textarea
          className="mt-1 min-h-24 w-full rounded-lg border border-[var(--border)] px-3 py-2"
          maxLength={1000}
          name="reason"
          required
        />
      </label>
      <div className="flex items-center gap-3 md:col-span-2 xl:col-span-4">
        <button
          className="min-h-11 rounded-lg bg-[var(--accent)] px-4 text-sm font-semibold text-white disabled:opacity-60"
          disabled={pending}
          type="submit"
        >
          {pending ? "Posting…" : transfer ? "Post transfer" : "Post movement"}
        </button>
        {state.message && (
          <p className="text-sm" role="status">
            {state.message}
          </p>
        )}
      </div>
      <p className="text-xs text-[var(--muted)] md:col-span-2 xl:col-span-4">
        Use quantity + unit for normal input. For finished goods, cartons/loose may be used instead
        and are stored only as canonical pieces.
      </p>
    </form>
  );
}

function warehouseOptions(warehouses: readonly WarehouseRecord[]) {
  return warehouses.map((warehouse) => ({
    value: warehouse.id,
    label: `${warehouse.code} · ${warehouse.name}`,
  }));
}
function Select({
  label,
  name,
  options,
  required = true,
}: {
  label: string;
  name: string;
  options: readonly { value: string; label: string }[];
  required?: boolean;
}) {
  return (
    <label className="text-sm font-medium">
      {label}
      <select
        className="mt-1 min-h-11 w-full rounded-lg border border-[var(--border)] bg-white px-3"
        name={name}
        required={required}
      >
        <option value="">Select…</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}
function Field({
  label,
  name,
  placeholder,
  inputMode,
  required = true,
}: {
  label: string;
  name: string;
  placeholder?: string;
  inputMode?: "decimal" | "numeric";
  required?: boolean;
}) {
  return (
    <label className="text-sm font-medium">
      {label}
      <input
        className="mt-1 min-h-11 w-full rounded-lg border border-[var(--border)] px-3"
        inputMode={inputMode}
        name={name}
        placeholder={placeholder}
        required={required}
      />
    </label>
  );
}
