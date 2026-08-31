"use client";

import { useActionState } from "react";
import { initialPurchasingActionState, type PurchasingAction } from "./action-state";

export function ApproveOrderForm({ action, id }: { action: PurchasingAction; id: string }) {
  const [state, formAction, pending] = useActionState(action, initialPurchasingActionState);
  return (
    <form action={formAction} className="flex flex-wrap items-center gap-2">
      <input name="id" type="hidden" value={id} />
      <button
        className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
        disabled={pending}
        type="submit"
      >
        {pending ? "Approving..." : "Approve PO"}
      </button>
      {state.message && <span className="text-sm">{state.message}</span>}
    </form>
  );
}

export function CancelOrderForm({ action, id }: { action: PurchasingAction; id: string }) {
  const [state, formAction, pending] = useActionState(action, initialPurchasingActionState);
  return (
    <form action={formAction} className="flex flex-wrap items-end gap-2">
      <input name="id" type="hidden" value={id} />
      <label className="text-sm font-medium">
        Cancellation reason
        <input
          className="mt-1 min-h-10 rounded-lg border border-[var(--border)] px-3"
          minLength={3}
          name="reason"
          required
        />
      </label>
      <button
        className="min-h-10 rounded-lg border border-red-300 px-4 text-sm font-semibold text-red-700 disabled:opacity-60"
        disabled={pending}
        type="submit"
      >
        {pending ? "Cancelling..." : "Cancel PO"}
      </button>
      {state.message && <span className="text-sm">{state.message}</span>}
    </form>
  );
}
