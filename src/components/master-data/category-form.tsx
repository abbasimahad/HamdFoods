"use client";

import { useActionState } from "react";
import { ActionFeedback } from "@/components/ui/action-feedback";
import { FormActions } from "@/components/ui/form-actions";
import { initialMasterActionState, type MasterAction } from "./action-state";
import { ITEM_TYPES } from "@/modules/master-data/domain/master-data";
import type { CategoryRecord } from "@/modules/master-data/application/contracts";

export function CategoryForm({
  action,
  initial,
}: {
  action: MasterAction;
  initial?: CategoryRecord;
}) {
  const [state, formAction, pending] = useActionState(action, initialMasterActionState);
  return (
    <form action={formAction} className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
      {initial && <input name="id" type="hidden" value={initial.id} />}
      <label className="text-sm font-medium">
        Code
        <input
          className="mt-1 min-h-11 w-full rounded-lg border border-[var(--border)] px-3"
          defaultValue={initial?.code}
          name="code"
          required
        />
      </label>
      <label className="text-sm font-medium">
        Name
        <input
          className="mt-1 min-h-11 w-full rounded-lg border border-[var(--border)] px-3"
          defaultValue={initial?.name}
          name="name"
          required
        />
      </label>
      <label className="text-sm font-medium">
        Item type
        <select
          className="mt-1 min-h-11 w-full rounded-lg border border-[var(--border)] bg-white px-3"
          defaultValue={initial?.itemType}
          name="itemType"
          required
        >
          {ITEM_TYPES.map((type) => (
            <option key={type}>{type}</option>
          ))}
        </select>
      </label>
      <label className="text-sm font-medium">
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
        submitLabel={initial ? "Save category" : "Create category"}
      />
      <ActionFeedback
        className="md:col-span-2 xl:col-span-4"
        message={state.message}
        ok={state.status === "success"}
      />
    </form>
  );
}
