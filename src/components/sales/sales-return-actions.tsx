"use client";
import { useActionState, useState } from "react";
type State = { ok: boolean; message: string };
type Action = (state: State, form: FormData) => Promise<State>;
export function SalesReturnAction({
  action,
  id,
  label,
  needsReason = false,
}: {
  action: Action;
  id: string;
  label: string;
  needsReason?: boolean;
}) {
  const [state, formAction, pending] = useActionState(action, { ok: false, message: "" });
  const [reason, setReason] = useState("");
  return (
    <form action={formAction} className="inline-flex flex-col gap-1">
      <input name="id" type="hidden" value={id} />
      {needsReason && (
        <input
          className="rounded border p-2 text-sm"
          minLength={3}
          name="reason"
          placeholder="Reason"
          required
          value={reason}
          onChange={(event) => setReason(event.target.value)}
        />
      )}
      <button
        className="rounded-lg border border-[var(--accent)] px-3 py-2 text-sm font-semibold text-[var(--accent)] disabled:opacity-50"
        disabled={pending}
        type="submit"
      >
        {pending ? "Working..." : label}
      </button>
      {state.message && (
        <span className={state.ok ? "text-xs text-green-700" : "text-xs text-red-700"}>
          {state.message}
        </span>
      )}
    </form>
  );
}
