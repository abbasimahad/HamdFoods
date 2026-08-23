"use client";

import { useActionState } from "react";
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
      <div className="flex items-center gap-3 md:col-span-2 xl:col-span-4">
        <button
          className="min-h-11 rounded-lg bg-[var(--accent)] px-4 text-sm font-semibold text-white disabled:opacity-60"
          disabled={pending}
          type="submit"
        >
          {pending ? "Saving…" : initial ? "Save category" : "Create category"}
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
