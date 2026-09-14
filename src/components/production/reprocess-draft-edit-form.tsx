"use client";

import { useActionState } from "react";

import { ActionFeedback } from "@/components/ui/action-feedback";
import { FormActions } from "@/components/ui/form-actions";
import { SingleFlightForm } from "@/components/ui/single-flight-form";
import { initialProductionActionState, type ProductionAction } from "./action-state";

export function ReprocessDraftEditForm({
  action,
  id,
  reason,
  notes,
}: {
  action: ProductionAction;
  id: string;
  reason: string;
  notes: string;
}) {
  const [state, formAction] = useActionState(action, initialProductionActionState);
  return (
    <SingleFlightForm action={formAction} className="space-y-4">
      <input name="id" type="hidden" value={id} />
      <label className="block text-sm font-medium">
        Reason
        <input
          className="mt-1 min-h-11 w-full rounded-lg border border-[var(--control-border)] px-3"
          defaultValue={reason}
          maxLength={1000}
          minLength={3}
          name="reason"
          required
        />
      </label>
      <label className="block text-sm font-medium">
        Notes
        <textarea
          className="mt-1 min-h-24 w-full rounded-lg border border-[var(--control-border)] px-3 py-2"
          defaultValue={notes}
          maxLength={3000}
          name="notes"
        />
      </label>
      <FormActions
        cancelHref={`/production/reprocess/${id}`}
        pendingLabel="Saving draft..."
        submitLabel="Save Reprocess draft"
      />
      <ActionFeedback message={state.message} ok={state.ok} />
      <p className="text-xs text-[var(--muted)]">
        Source custody, shelf-life snapshots, quantity, and the linked batch remain fixed. Cancel
        and create a new document if those references are wrong.
      </p>
    </SingleFlightForm>
  );
}
