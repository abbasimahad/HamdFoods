"use client";

import { useActionState } from "react";
import { initialPurchasingActionState, type PurchasingAction } from "./action-state";

export function SupplierStatusForm({
  action,
  id,
  active,
}: {
  action: PurchasingAction;
  id: string;
  active: boolean;
}) {
  const [state, formAction, pending] = useActionState(action, initialPurchasingActionState);
  return (
    <form action={formAction} className="flex items-center gap-2">
      <input name="id" type="hidden" value={id} />
      <input name="active" type="hidden" value={String(!active)} />
      <button
        className="text-xs font-semibold text-[var(--accent)] disabled:opacity-60"
        disabled={pending}
        type="submit"
      >
        {active ? "Deactivate" : "Activate"}
      </button>
      {state.message && !state.ok && <span className="text-xs text-red-700">{state.message}</span>}
    </form>
  );
}
