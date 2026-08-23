"use client";

import { useActionState } from "react";

import { initialInventoryActionState, type InventoryAction } from "./action-state";

export function WarehouseStatusForm({
  action,
  id,
  active,
}: {
  action: InventoryAction;
  id: string;
  active: boolean;
}) {
  const [state, formAction, pending] = useActionState(action, initialInventoryActionState);
  return (
    <form action={formAction}>
      <input name="id" type="hidden" value={id} />
      <input name="active" type="hidden" value={String(!active)} />
      <button
        className="text-xs font-semibold text-[var(--accent)] disabled:opacity-60"
        disabled={pending}
        type="submit"
      >
        {pending ? "Updating…" : active ? "Deactivate" : "Activate"}
      </button>
      {state.message && (
        <p className="mt-1 text-xs" role="status">
          {state.message}
        </p>
      )}
    </form>
  );
}
