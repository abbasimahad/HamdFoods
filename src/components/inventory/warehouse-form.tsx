"use client";

import { useActionState } from "react";
import { ActionFeedback } from "@/components/ui/action-feedback";
import { FormActions } from "@/components/ui/form-actions";

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
      <FormActions
        className="md:col-span-2 xl:col-span-4"
        disabled={pending}
        onCancel={(event) => event.currentTarget.form?.reset()}
        pendingLabel="Saving…"
        submitLabel={initial ? "Save warehouse" : "Create warehouse"}
      />
      <ActionFeedback
        className="md:col-span-2 xl:col-span-4"
        message={state.message}
        ok={state.ok}
      />
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
