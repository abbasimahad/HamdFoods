"use client";

import { useActionState, useState } from "react";
import { SingleFlightForm } from "@/components/ui/single-flight-form";
import { initialProductionActionState, type ProductionAction } from "./action-state";

export function ReprocessLifecycleAction({
  id,
  action,
  label,
  pendingLabel,
}: {
  id: string;
  action: ProductionAction;
  label: string;
  pendingLabel: string;
}) {
  const [state, formAction, pending] = useActionState(action, initialProductionActionState);
  return (
    <SingleFlightForm action={formAction} className="space-y-2">
      <input name="id" type="hidden" value={id} />
      <button
        className="min-h-11 rounded-lg bg-[var(--accent)] px-4 text-sm font-semibold text-white disabled:opacity-60"
        disabled={pending}
      >
        {pending ? pendingLabel : label}
      </button>
      {state.message && (
        <p className="text-sm" role="status">
          {state.message}
        </p>
      )}
    </SingleFlightForm>
  );
}
export function ReprocessReasonAction({
  id,
  action,
  label,
  fieldLabel,
}: {
  id: string;
  action: ProductionAction;
  label: string;
  fieldLabel: string;
}) {
  const [state, formAction, pending] = useActionState(action, initialProductionActionState);
  return (
    <SingleFlightForm action={formAction} className="flex flex-wrap items-end gap-3">
      <input name="id" type="hidden" value={id} />
      <label className="min-w-64 flex-1 text-sm font-medium">
        {fieldLabel}
        <input
          className="mt-1 min-h-11 w-full rounded-lg border px-3"
          minLength={3}
          name="reason"
          required
        />
      </label>
      <button
        className="min-h-11 rounded-lg border border-red-300 px-4 text-sm font-semibold text-red-700 disabled:opacity-60"
        disabled={pending}
      >
        {pending ? "Working..." : label}
      </button>
      {state.message && (
        <p className="w-full text-sm" role="status">
          {state.message}
        </p>
      )}
    </SingleFlightForm>
  );
}
export function ReprocessQualityAction({ id, action }: { id: string; action: ProductionAction }) {
  const [state, formAction, pending] = useActionState(action, initialProductionActionState);
  const [decision, setDecision] = useState<"APPROVED" | "REJECTED">("APPROVED");
  return (
    <SingleFlightForm action={formAction} className="space-y-3">
      <input name="id" type="hidden" value={id} />
      <div className="grid gap-3 md:grid-cols-2">
        <label className="text-sm font-medium">
          Decision
          <select
            className="mt-1 min-h-11 w-full rounded-lg border bg-white px-3"
            name="decision"
            onChange={(event) => setDecision(event.target.value as "APPROVED" | "REJECTED")}
            value={decision}
          >
            <option value="APPROVED">Approve and release</option>
            <option value="REJECTED">Reject to quarantine</option>
          </select>
        </label>
        <label className="text-sm font-medium">
          Rejection reason
          <select
            className="mt-1 min-h-11 w-full rounded-lg border bg-white px-3"
            disabled={decision === "APPROVED"}
            name="rejectionReason"
            required={decision === "REJECTED"}
          >
            <option value="">Not applicable</option>
            <option value="QUALITY_REJECT">Quality reject</option>
            <option value="CONTAMINATED">Contaminated</option>
            <option value="SPOILED">Spoiled</option>
            <option value="OTHER">Other</option>
          </select>
        </label>
      </div>
      <label className="block text-sm font-medium">
        Inspection notes
        <textarea className="mt-1 min-h-20 w-full rounded-lg border px-3 py-2" name="notes" />
      </label>
      <button
        className="min-h-11 rounded-lg bg-[var(--accent)] px-4 font-semibold text-white disabled:opacity-60"
        disabled={pending}
      >
        {pending ? "Posting quality decision..." : "Post quality decision"}
      </button>
      {state.message && (
        <p className="text-sm" role="status">
          {state.message}
        </p>
      )}
    </SingleFlightForm>
  );
}
