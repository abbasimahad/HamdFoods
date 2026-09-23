"use client";

import { useActionState, useState } from "react";
import { UNIT_DIMENSION_LABELS } from "@/modules/master-data/domain/master-data";

import type {
  InventoryItemOption,
  InventoryUnitOption,
  WarehouseRecord,
} from "@/modules/inventory/application/contracts";
import { INVENTORY_STATUSES } from "@/modules/inventory/domain/inventory";
import { ActionFeedback } from "@/components/ui/action-feedback";
import { FormActions } from "@/components/ui/form-actions";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { SingleFlightForm } from "@/components/ui/single-flight-form";

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
  const [state, formAction] = useActionState(action, initialInventoryActionState);
  const transfer = mode === "TRANSFER";
  const [itemId, setItemId] = useState("");
  const [warehouseId, setWarehouseId] = useState("");
  const [sourceWarehouseId, setSourceWarehouseId] = useState("");
  const [destinationWarehouseId, setDestinationWarehouseId] = useState("");

  function resetForm(form: HTMLFormElement | null) {
    form?.reset();
    setItemId("");
    setWarehouseId("");
    setSourceWarehouseId("");
    setDestinationWarehouseId("");
  }

  return (
    <SingleFlightForm action={formAction} className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
      {!transfer && <input name="movementType" type="hidden" value={mode} />}
      <SearchableSelect
        label="Item"
        name="itemId"
        onValueChange={setItemId}
        options={items.map((item) => ({
          value: item.id,
          label: `${item.code} · ${item.name}`,
          keywords: item.name,
        }))}
        value={itemId}
      />
      {transfer ? (
        <>
          <SearchableSelect
            label="Source warehouse"
            name="sourceWarehouseId"
            onValueChange={setSourceWarehouseId}
            options={warehouseOptions(warehouses)}
            value={sourceWarehouseId}
          />
          <SearchableSelect
            label="Destination warehouse"
            name="destinationWarehouseId"
            onValueChange={setDestinationWarehouseId}
            options={warehouseOptions(warehouses)}
            value={destinationWarehouseId}
          />
        </>
      ) : (
        <SearchableSelect
          label="Warehouse"
          name="warehouseId"
          onValueChange={setWarehouseId}
          options={warehouseOptions(warehouses)}
          value={warehouseId}
        />
      )}
      <NativeSelect
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
      <NativeSelect
        label="Quantity unit"
        name="unitId"
        required={false}
        options={units.map((unit) => ({
          value: unit.id,
          label: `${unit.symbol} · ${UNIT_DIMENSION_LABELS[unit.dimension]}`,
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
      {!transfer && mode !== "ADJUSTMENT_OUT" && (
        <Field
          label="Unit cost (canonical unit)"
          name="unitCost"
          placeholder="Required for valued inbound stock"
          inputMode="decimal"
        />
      )}
      <Field
        label="Source key (optional)"
        name="sourceKey"
        placeholder="Stable import/event key"
        required={false}
      />
      <label className="text-sm font-medium md:col-span-2">
        Reason
        <textarea
          className="mt-1 min-h-24 w-full rounded-lg border border-[var(--control-border)] px-3 py-2"
          maxLength={1000}
          name="reason"
          required
        />
      </label>
      <div className="flex flex-wrap items-center gap-3 md:col-span-2 xl:col-span-4">
        <FormActions
          onCancel={(event) => resetForm(event.currentTarget.form)}
          pendingLabel="Posting…"
          submitLabel={transfer ? "Post transfer" : "Post movement"}
        />
        <ActionFeedback message={state.message} ok={state.ok} />
      </div>
      <p className="text-xs text-[var(--muted)] md:col-span-2 xl:col-span-4">
        Use quantity + unit for normal input. For finished goods, cartons/loose may be used instead
        and are stored only as canonical pieces.
      </p>
    </SingleFlightForm>
  );
}

function warehouseOptions(warehouses: readonly WarehouseRecord[]) {
  return warehouses.map((warehouse) => ({
    value: warehouse.id,
    label: `${warehouse.code} · ${warehouse.name}`,
    keywords: warehouse.name,
  }));
}
function NativeSelect({
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
        className="mt-1 min-h-11 w-full rounded-lg border border-[var(--control-border)] bg-white px-3"
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
        className="mt-1 min-h-11 w-full rounded-lg border border-[var(--control-border)] px-3"
        inputMode={inputMode}
        name={name}
        placeholder={placeholder}
        required={required}
      />
    </label>
  );
}
