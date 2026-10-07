"use client";

import { useActionState } from "react";
import { initialSalesOrderActionState, type SalesOrderAction } from "./sales-order-action-state";

export function ApproveSalesOrderForm({
  action,
  id,
  canOverrideCredit = false,
}: {
  action: SalesOrderAction;
  id: string;
  canOverrideCredit?: boolean;
}) {
  const [state, formAction, pending] = useActionState(action, initialSalesOrderActionState);
  const creditBlocked = !state.ok && state.message.startsWith("Credit limit exceeded");
  return (
    <form action={formAction} className="space-y-3">
      <input name="id" type="hidden" value={id} />
      {canOverrideCredit && (
        // ROLE-3: an authorised manager can approve over the credit limit with a written reason.
        <details className="text-sm" open={creditBlocked}>
          <summary className="cursor-pointer font-medium">Approve over credit limit</summary>
          <label className="mt-2 block">
            Override reason (recorded in the audit log)
            <textarea
              className="mt-1 min-h-16 w-full rounded-lg border px-3 py-2"
              maxLength={500}
              minLength={15}
              name="creditOverrideReason"
              placeholder="Why this customer may exceed the limit, e.g. cheque received, owner approval"
            />
          </label>
        </details>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <button
          className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
          disabled={pending}
        >
          Approve & reserve stock
        </button>
        {state.message && (
          <span className="text-sm" role="status">
            {state.message}
            {creditBlocked && !canOverrideCredit
              ? " A manager with credit-limit override permission can approve it with a reason."
              : ""}
          </span>
        )}
      </div>
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
