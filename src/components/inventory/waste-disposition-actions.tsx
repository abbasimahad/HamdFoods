"use client";

import { useActionState } from "react";
import { SingleFlightForm } from "@/components/ui/single-flight-form";
import { initialInventoryActionState, type InventoryAction } from "./action-state";

export function WastePostAction({ id, action }: { id: string; action: InventoryAction }) {
  const [state, formAction, pending] = useActionState(action, initialInventoryActionState);
  return (
    <SingleFlightForm action={formAction} className="space-y-2">
      <input name="id" type="hidden" value={id} />
      <button
        className="min-h-11 rounded-lg bg-[var(--accent)] px-4 font-semibold text-white disabled:opacity-60"
        disabled={pending}
      >
        {pending ? "Rechecking and posting..." : "Post disposition"}
      </button>
      {state.message && (
        <p className="text-sm" role="status">
          {state.message}
        </p>
      )}
    </SingleFlightForm>
  );
}
export function WasteReasonAction({
  id,
  action,
  kind,
}: {
  id: string;
  action: InventoryAction;
  kind: "cancel" | "reverse";
}) {
  const [state, formAction, pending] = useActionState(action, initialInventoryActionState);
  const label = kind === "cancel" ? "Cancel draft" : "Reverse disposition";
  return (
    <SingleFlightForm action={formAction} className="flex flex-wrap items-end gap-3">
      <input name="id" type="hidden" value={id} />
      <label className="min-w-64 flex-1 text-sm font-medium">
        {kind === "cancel" ? "Cancellation reason" : "Reversal reason"}
        <input
          className="mt-1 min-h-11 w-full rounded-lg border px-3"
          minLength={3}
          name="reason"
          required
        />
      </label>
      <button
        className="min-h-11 rounded-lg border border-red-300 px-4 font-semibold text-red-700 disabled:opacity-60"
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
