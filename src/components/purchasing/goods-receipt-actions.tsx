"use client";
import { useActionState } from "react";
import { initialPurchasingActionState, type PurchasingAction } from "./action-state";
export function PostGoodsReceiptForm({ action, id }: { action: PurchasingAction; id: string }) {
  const [state, formAction, pending] = useActionState(action, initialPurchasingActionState);
  return (
    <form action={formAction} className="flex items-center gap-2">
      <input name="id" type="hidden" value={id} />
      <button
        className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
        disabled={pending}
        type="submit"
      >
        {pending ? "Posting..." : "Post to quality hold"}
      </button>
      {state.message && <span className="text-sm">{state.message}</span>}
    </form>
  );
}
export function CancelGoodsReceiptForm({ action, id }: { action: PurchasingAction; id: string }) {
  const [state, formAction, pending] = useActionState(action, initialPurchasingActionState);
  return (
    <form action={formAction} className="flex flex-wrap items-end gap-2">
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
        className="min-h-10 rounded-lg border border-red-300 px-4 text-sm font-semibold text-red-700"
        disabled={pending}
        type="submit"
      >
        Cancel draft
      </button>
      {state.message && <span className="text-sm">{state.message}</span>}
    </form>
  );
}
