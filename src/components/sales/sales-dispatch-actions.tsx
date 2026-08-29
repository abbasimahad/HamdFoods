"use client";
import { useActionState } from "react";
import {
  initialSalesDispatchActionState,
  type SalesDispatchAction,
} from "./sales-dispatch-action-state";
export function PostSalesDispatchForm({ action, id }: { action: SalesDispatchAction; id: string }) {
  const [state, formAction, pending] = useActionState(action, initialSalesDispatchActionState);
  return (
    <form action={formAction} className="flex flex-wrap items-center gap-3">
      <input name="id" type="hidden" value={id} />
      <button
        className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
        disabled={pending}
      >
        Post dispatch
      </button>
      {state.message && (
        <span className="text-sm" role="status">
          {state.message}
        </span>
      )}
    </form>
  );
}
export function ConfirmDeliveryForm({ action, id }: { action: SalesDispatchAction; id: string }) {
  const [state, formAction, pending] = useActionState(action, initialSalesDispatchActionState);
  return (
    <form action={formAction} className="flex flex-wrap items-center gap-3">
      <input name="id" type="hidden" value={id} />
      <input
        className="min-h-10 rounded border px-3"
        name="receiverName"
        placeholder="Receiver name (optional)"
      />
      <input
        className="min-h-10 rounded border px-3"
        name="notes"
        placeholder="Delivery notes (optional)"
      />
      <button
        className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
        disabled={pending}
      >
        Mark delivered
      </button>
      {state.message && (
        <span className="text-sm" role="status">
          {state.message}
        </span>
      )}
    </form>
  );
}
export function CancelDispatchForm({ action, id }: { action: SalesDispatchAction; id: string }) {
  const [state, formAction, pending] = useActionState(action, initialSalesDispatchActionState);
  return (
    <form action={formAction} className="flex flex-wrap items-center gap-3">
      <input name="id" type="hidden" value={id} />
      <input
        className="min-h-10 rounded border px-3"
        name="reason"
        placeholder="Cancellation reason"
        required
      />
      <button
        className="rounded-lg border border-red-300 px-4 py-2 text-sm font-semibold text-red-700 disabled:opacity-60"
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
