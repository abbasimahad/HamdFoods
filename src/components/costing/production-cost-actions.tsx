"use client";

import { useActionState } from "react";
import type { CostingAction } from "./costing-action-state";
import { initialCostingActionState } from "./costing-action-state";

export function AddProductionCostForm({
  action,
  batchId,
}: {
  action: CostingAction;
  batchId: string;
}) {
  const [state, formAction, pending] = useActionState(action, initialCostingActionState);
  return (
    <form action={formAction} className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
      <input name="productionBatchId" type="hidden" value={batchId} />
      <select className="rounded-lg border bg-white px-3 py-2" name="category" required>
        <option value="DIRECT_LABOR">Direct labor</option>
        <option value="MACHINE">Machine</option>
        <option value="UTILITIES">Utilities</option>
        <option value="FACTORY_OVERHEAD">Factory overhead</option>
        <option value="OTHER_DIRECT">Other direct</option>
        <option value="COST_CREDIT">Cost credit / recovery</option>
      </select>
      <input
        className="rounded-lg border px-3 py-2"
        inputMode="decimal"
        name="amount"
        placeholder="Exact amount"
        required
      />
      <input
        className="rounded-lg border px-3 py-2"
        name="reference"
        placeholder="Reference (optional)"
      />
      <input
        className="rounded-lg border px-3 py-2"
        name="description"
        placeholder="Description"
        required
      />
      <button
        className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
        disabled={pending}
      >
        Add cost entry
      </button>
      {state.message && (
        <span className="text-sm md:col-span-2 xl:col-span-3" role="status">
          {state.message}
        </span>
      )}
    </form>
  );
}
export function FinalizeProductionCostForm({
  action,
  batchId,
}: {
  action: CostingAction;
  batchId: string;
}) {
  const [state, formAction, pending] = useActionState(action, initialCostingActionState);
  return (
    <form action={formAction} className="flex flex-wrap items-center gap-3">
      <input name="batchId" type="hidden" value={batchId} />
      <button
        className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
        disabled={pending}
      >
        Finalize batch cost
      </button>
      {state.message && (
        <span className="text-sm" role="status">
          {state.message}
        </span>
      )}
    </form>
  );
}
