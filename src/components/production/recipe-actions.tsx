"use client";

import { useActionState } from "react";
import { initialProductionActionState, type ProductionAction } from "./action-state";

function LifecycleForm({
  action,
  id,
  label,
  accent = false,
}: {
  action: ProductionAction;
  id: string;
  label: string;
  accent?: boolean;
}) {
  const [state, formAction, pending] = useActionState(action, initialProductionActionState);
  return (
    <form action={formAction} className="flex items-center gap-2">
      <input name="id" type="hidden" value={id} />
      <button
        className={
          accent
            ? "rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
            : "rounded-lg border px-4 py-2 text-sm font-semibold disabled:opacity-60"
        }
        disabled={pending}
      >
        {pending ? "Working..." : label}
      </button>
      {state.message && (
        <span className="text-sm" role="status">
          {state.message}
        </span>
      )}
    </form>
  );
}
export function ApproveRecipeForm(props: { action: ProductionAction; id: string }) {
  return <LifecycleForm {...props} accent label="Approve recipe" />;
}
export function InactivateRecipeForm(props: { action: ProductionAction; id: string }) {
  return <LifecycleForm {...props} label="Make inactive" />;
}
export function NewRecipeVersionForm(props: { action: ProductionAction; id: string }) {
  return <LifecycleForm {...props} label="Create New Version" />;
}
