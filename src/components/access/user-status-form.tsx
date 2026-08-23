"use client";

import { useActionState } from "react";
import {
  initialUserActionState,
  setUserStatusAction,
} from "@/app/(erp)/administration/users/actions";

export function UserStatusForm({ userId, active }: { userId: string; active: boolean }) {
  const [state, action, pending] = useActionState(setUserStatusAction, initialUserActionState);
  return (
    <form action={action}>
      <input name="userId" type="hidden" value={userId} />
      <input name="active" type="hidden" value={String(!active)} />
      <button
        className="rounded border border-[var(--border)] px-3 py-2 text-xs font-semibold disabled:opacity-60"
        disabled={pending}
        type="submit"
      >
        {pending ? "Updating…" : active ? "Deactivate" : "Activate"}
      </button>
      {state.message && (
        <p className="mt-1 text-xs" role="status">
          {state.message}
        </p>
      )}
    </form>
  );
}
