"use client";

import { useActionState } from "react";

import { initialMasterActionState, type MasterAction } from "@/components/master-data/action-state";

export function MasterStatusForm({
  action,
  id,
  active,
}: {
  action: MasterAction;
  id: string;
  active: boolean;
}) {
  const [state, formAction, pending] = useActionState(action, initialMasterActionState);
  return (
    <form action={formAction}>
      <input name="id" type="hidden" value={id} />
      <input name="active" type="hidden" value={String(!active)} />
      <button
        className="rounded-lg border border-[var(--border)] px-3 py-2 text-xs font-semibold disabled:opacity-60"
        disabled={pending}
        type="submit"
      >
        {pending ? "Updating…" : active ? "Deactivate" : "Activate"}
      </button>
      {state.message && (
        <p className="mt-1 max-w-48 text-xs" role="status">
          {state.message}
        </p>
      )}
    </form>
  );
}
