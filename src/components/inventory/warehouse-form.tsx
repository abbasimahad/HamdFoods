"use client";

import { useActionState } from "react";

import type { WarehouseRecord } from "@/modules/inventory/application/contracts";

import { initialInventoryActionState, type InventoryAction } from "./action-state";

export function WarehouseForm({
  action,
  initial,
}: {
  action: InventoryAction;
  initial?: WarehouseRecord;
}) {
  const [state, formAction, pending] = useActionState(action, initialInventoryActionState);
  return (
    <form action={formAction} className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
      {initial && <input name="id" type="hidden" value={initial.id} />}
      <Field defaultValue={initial?.code} label="Code" name="code" />
      <Field defaultValue={initial?.name} label="Name" name="name" />
      <label className="text-sm font-medium md:col-span-2">
        Description
        <input
          className="mt-1 min-h-11 w-full rounded-lg border border-[var(--border)] px-3"
          defaultValue={initial?.description ?? ""}
          name="description"
        />
      </label>
      <div className="flex items-center gap-3 md:col-span-2 xl:col-span-4">
        <button
          className="min-h-11 rounded-lg bg-[var(--accent)] px-4 text-sm font-semibold text-white disabled:opacity-60"
          disabled={pending}
          type="submit"
        >
          {pending ? "Saving…" : initial ? "Save warehouse" : "Create warehouse"}
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

function Field({
  label,
  name,
  defaultValue,
}: {
  label: string;
  name: string;
  defaultValue?: string | undefined;
}) {
  return (
    <label className="text-sm font-medium">
      {label}
      <input
        className="mt-1 min-h-11 w-full rounded-lg border border-[var(--border)] px-3"
        defaultValue={defaultValue}
        name={name}
        required
      />
    </label>
  );
}
