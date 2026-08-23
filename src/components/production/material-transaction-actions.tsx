"use client";

import { useActionState } from "react";
import { initialProductionActionState, type ProductionActionState } from "./action-state";

type Action = (state: ProductionActionState, data: FormData) => Promise<ProductionActionState>;

export function PostMaterialTransactionForm({
  transactionId,
  productionBatchId,
  action,
}: {
  transactionId: string;
  productionBatchId: string;
  action: Action;
}) {
  const [state, formAction, pending] = useActionState(action, initialProductionActionState);
  return (
    <form action={formAction} className="space-y-1">
      <input name="transactionId" type="hidden" value={transactionId} />
      <input name="productionBatchId" type="hidden" value={productionBatchId} />
      <button
        className="rounded-lg bg-[var(--accent)] px-3 py-2 text-xs font-semibold text-white disabled:opacity-60"
        disabled={pending}
      >
        {pending ? "Posting..." : "Post"}
      </button>
      {state.message && (
        <p className="max-w-72 text-xs" role="status">
          {state.message}
        </p>
      )}
    </form>
  );
}

export function CancelMaterialTransactionForm({
  transactionId,
  productionBatchId,
  action,
}: {
  transactionId: string;
  productionBatchId: string;
  action: Action;
}) {
  const [state, formAction, pending] = useActionState(action, initialProductionActionState);
  return (
    <form action={formAction} className="mt-2 flex min-w-72 gap-2">
      <input name="transactionId" type="hidden" value={transactionId} />
      <input name="productionBatchId" type="hidden" value={productionBatchId} />
      <input
        className="min-h-9 min-w-44 rounded-lg border px-2 text-xs"
        maxLength={1000}
        minLength={3}
        name="reason"
        placeholder="Cancellation reason"
        required
      />
      <button
        className="rounded-lg border border-red-300 px-3 text-xs font-semibold text-red-700 disabled:opacity-60"
        disabled={pending}
      >
        Cancel
      </button>
      {state.message && (
        <p className="text-xs" role="status">
          {state.message}
        </p>
      )}
    </form>
  );
}
