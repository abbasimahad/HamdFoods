"use client";

import { useActionState } from "react";
import { initialPurchasingActionState, type PurchasingAction } from "./action-state";

export function PostPurchaseReturnForm({ action, id }: { action: PurchasingAction; id: string }) {
  const [state, formAction, pending] = useActionState(action, initialPurchasingActionState);
  return (
    <form action={formAction} className="flex flex-wrap items-center gap-3">
      <input name="id" type="hidden" value={id} />
      <button
        className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
        disabled={pending}
      >
        {pending ? "Posting..." : "Post supplier return"}
      </button>
      {state.message && (
        <span className="text-sm" role="status">
          {state.message}
        </span>
      )}
    </form>
  );
}
export function CancelPurchaseReturnForm({ action, id }: { action: PurchasingAction; id: string }) {
  const [state, formAction, pending] = useActionState(action, initialPurchasingActionState);
  return (
    <form action={formAction} className="flex flex-wrap items-end gap-3">
      <input name="id" type="hidden" value={id} />
      <label className="text-sm font-medium">
        Cancellation reason
        <input
          className="mt-1 min-h-10 rounded-lg border px-3"
          minLength={3}
          name="reason"
          required
        />
      </label>
      <button
        className="rounded-lg border border-red-300 px-4 py-2 text-sm font-semibold text-red-800 disabled:opacity-60"
        disabled={pending}
      >
        Cancel draft
      </button>
      {state.message && (
        <span className="text-sm" role="status">
          {state.message}
        </span>
      )}
    </form>
  );
}
