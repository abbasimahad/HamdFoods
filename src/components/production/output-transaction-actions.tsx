"use client";

import { useActionState } from "react";
import { initialProductionActionState, type ProductionActionState } from "./action-state";

type Action = (state: ProductionActionState, data: FormData) => Promise<ProductionActionState>;

export function PostOutputForm({
  action,
  batchId,
  transactionId,
}: {
  action: Action;
  batchId: string;
  transactionId: string;
}) {
  const [state, formAction, pending] = useActionState(action, initialProductionActionState);
  return (
    <form action={formAction} className="space-y-1">
      <input name="batchId" type="hidden" value={batchId} />
      <input name="transactionId" type="hidden" value={transactionId} />
      <button
        className="rounded-lg bg-[var(--accent)] px-3 py-2 text-xs font-semibold text-white disabled:opacity-60"
        disabled={pending}
      >
        {pending ? "Posting..." : "Post"}
      </button>
      {state.message && (
        <p className="text-xs" role="status">
          {state.message}
        </p>
      )}
    </form>
  );
}

export function CancelOutputForm({
  action,
  batchId,
  transactionId,
}: {
  action: Action;
  batchId: string;
  transactionId: string;
}) {
  const [state, formAction, pending] = useActionState(action, initialProductionActionState);
  return (
    <form action={formAction} className="mt-2 flex min-w-72 gap-2">
      <input name="batchId" type="hidden" value={batchId} />
      <input name="transactionId" type="hidden" value={transactionId} />
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

export function CompleteBatchForm({
  action,
  batchId,
  requiresExplanation,
  blockers,
}: {
  action: Action;
  batchId: string;
  requiresExplanation: boolean;
  blockers: readonly string[];
}) {
  const [state, formAction, pending] = useActionState(action, initialProductionActionState);
  return (
    <form action={formAction} className="space-y-3">
      <input name="batchId" type="hidden" value={batchId} />
      {blockers.length > 0 && (
        <ul className="list-disc space-y-1 pl-5 text-sm text-red-700">
          {blockers.map((blocker) => (
            <li key={blocker}>{blocker}</li>
          ))}
        </ul>
      )}
      <label className="block text-sm font-medium">
        Completion reconciliation explanation{requiresExplanation ? " (required)" : " (optional)"}
        <textarea
          className="mt-1 min-h-24 w-full rounded-lg border px-3 py-2"
          maxLength={2000}
          name="explanation"
          required={requiresExplanation}
        />
      </label>
      <button
        className="rounded-lg bg-[var(--accent)] px-5 py-3 text-sm font-semibold text-white disabled:opacity-60"
        disabled={pending || blockers.length > 0}
      >
        {pending ? "Completing..." : "Complete Batch"}
      </button>
      {state.message && (
        <p className="text-sm" role="status">
          {state.message}
        </p>
      )}
    </form>
  );
}
