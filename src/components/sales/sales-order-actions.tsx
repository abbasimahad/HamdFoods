"use client";

import { useActionState } from "react";
import { initialSalesOrderActionState, type SalesOrderAction } from "./sales-order-action-state";

export function ApproveSalesOrderForm({ action, id }: { action: SalesOrderAction; id: string }) {
  const [state, formAction, pending] = useActionState(action, initialSalesOrderActionState);
  return (
    <form action={formAction} className="flex items-center gap-3">
      <input name="id" type="hidden" value={id} />
      <button
        className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
        disabled={pending}
      >
        Approve & reserve stock
      </button>
      {state.message && (
        <span className="text-sm" role="status">
          {state.message}
        </span>
      )}
    </form>
  );
}
export function ReserveRedeliveryStockForm({
  action,
  id,
}: {
  action: SalesOrderAction;
  id: string;
}) {
  const [state, formAction, pending] = useActionState(action, initialSalesOrderActionState);
  return (
    <form action={formAction} className="flex items-center gap-3">
      <input name="id" type="hidden" value={id} />
      <button
        className="rounded-lg border border-[var(--accent)] px-4 py-2 text-sm font-semibold text-[var(--accent)] disabled:opacity-60"
        disabled={pending}
      >
        Reserve redelivery stock
      </button>
      {state.message && (
        <span className="text-sm" role="status">
          {state.message}
        </span>
      )}
    </form>
  );
}
export function CancelSalesOrderForm({ action, id }: { action: SalesOrderAction; id: string }) {
  const [state, formAction, pending] = useActionState(action, initialSalesOrderActionState);
  return (
    <form action={formAction} className="flex flex-wrap items-center gap-3">
      <input name="id" type="hidden" value={id} />
      <input
        className="min-h-10 min-w-64 rounded-lg border border-[var(--border)] px-3"
        name="reason"
        placeholder="Cancellation reason"
        required
      />
      <button
        className="rounded-lg border border-red-300 px-4 py-2 text-sm font-semibold text-red-700 disabled:opacity-60"
        disabled={pending}
      >
        Cancel order
      </button>
      {state.message && (
        <span className="text-sm" role="status">
          {state.message}
        </span>
      )}
    </form>
  );
}
