"use client";

import { useActionState } from "react";
import { initialProductionActionState, type ProductionActionState } from "./action-state";

type Action = (state: ProductionActionState, data: FormData) => Promise<ProductionActionState>;

export function PlanBatchForm({ id, action }: { id: string; action: Action }) {
  return <SimpleLifecycleForm id={id} action={action} label="Plan batch" />;
}

export function ReleaseBatchForm({
  id,
  hasShortage,
  action,
}: {
  id: string;
  hasShortage: boolean;
  action: Action;
}) {
  const [state, formAction, pending] = useActionState(action, initialProductionActionState);
  return (
    <form action={formAction} className="space-y-3">
      <input name="id" type="hidden" value={id} />
      {hasShortage && (
        <label className="flex gap-2 rounded-lg border border-amber-400 bg-amber-50 p-3 text-sm text-amber-950">
          <input name="acknowledgeShortage" required type="checkbox" />I acknowledge the current
          raw-material or packaging shortage and still authorize release.
        </label>
      )}
      <button
        className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
        disabled={pending}
      >
        {pending ? "Rechecking stock..." : "Release for production"}
      </button>
      {state.message && (
        <p className="text-sm" role="status">
          {state.message}
        </p>
      )}
    </form>
  );
}

export function CancelBatchForm({ id, action }: { id: string; action: Action }) {
  const [state, formAction, pending] = useActionState(action, initialProductionActionState);
  return (
    <form action={formAction} className="flex flex-wrap items-end gap-3">
      <input name="id" type="hidden" value={id} />
      <label className="min-w-72 flex-1 text-sm font-medium">
        Cancellation reason
        <input
          className="mt-1 min-h-10 w-full rounded-lg border px-3"
          maxLength={1000}
          minLength={3}
          name="reason"
          required
        />
      </label>
      <button
        className="rounded-lg border border-red-300 px-4 py-2 text-sm font-semibold text-red-700 disabled:opacity-60"
        disabled={pending}
      >
        {pending ? "Cancelling..." : "Cancel batch"}
      </button>
      {state.message && (
        <p className="w-full text-sm" role="status">
          {state.message}
        </p>
      )}
    </form>
  );
}

function SimpleLifecycleForm({ id, action, label }: { id: string; action: Action; label: string }) {
  const [state, formAction, pending] = useActionState(action, initialProductionActionState);
  return (
    <form action={formAction} className="space-y-2">
      <input name="id" type="hidden" value={id} />
      <button
        className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
        disabled={pending}
      >
        {pending ? "Working..." : label}
      </button>
      {state.message && (
        <p className="text-sm" role="status">
          {state.message}
        </p>
      )}
    </form>
  );
}
