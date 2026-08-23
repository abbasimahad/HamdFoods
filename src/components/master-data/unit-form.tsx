"use client";

import { useActionState } from "react";

import { initialMasterActionState, type MasterAction } from "@/components/master-data/action-state";
import { UNIT_DIMENSIONS } from "@/modules/master-data/domain/master-data";
import type { UnitRecord } from "@/modules/master-data/application/contracts";

export function UnitForm({ action, initial }: { action: MasterAction; initial?: UnitRecord }) {
  const [state, formAction, pending] = useActionState(action, initialMasterActionState);
  return (
    <form action={formAction} className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
      {initial && <input name="id" type="hidden" value={initial.id} />}
      <Field defaultValue={initial?.code} label="Code" name="code" />
      <Field defaultValue={initial?.name} label="Name" name="name" />
      <Field defaultValue={initial?.symbol} label="Symbol" name="symbol" />
      <label className="text-sm font-medium">
        Dimension
        <select
          className="mt-1 min-h-11 w-full rounded-lg border border-[var(--border)] bg-white px-3"
          defaultValue={initial?.dimension}
          name="dimension"
          required
        >
          {UNIT_DIMENSIONS.map((dimension) => (
            <option key={dimension}>{dimension}</option>
          ))}
        </select>
      </label>
      <div className="flex items-end gap-3">
        <button
          className="min-h-11 rounded-lg bg-[var(--accent)] px-4 text-sm font-semibold text-white disabled:opacity-60"
          disabled={pending}
          type="submit"
        >
          {pending ? "Saving…" : initial ? "Save unit" : "Create unit"}
        </button>
      </div>
      {state.message && (
        <p className="text-sm sm:col-span-2 xl:col-span-5" role="status">
          {state.message}
        </p>
      )}
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
        maxLength={120}
        name={name}
        required
      />
    </label>
  );
}
