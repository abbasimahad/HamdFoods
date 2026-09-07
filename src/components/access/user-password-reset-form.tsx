"use client";

import { useActionState } from "react";

import {
  initialUserActionState,
  resetUserPasswordAction,
} from "@/app/(erp)/administration/users/actions";

export function UserPasswordResetForm({ userId }: { userId: string }) {
  const [state, action, pending] = useActionState(resetUserPasswordAction, initialUserActionState);
  return (
    <details className="mt-2">
      <summary className="cursor-pointer text-xs font-semibold text-[var(--accent)]">
        Reset password
      </summary>
      <form action={action} className="mt-2 space-y-2">
        <input name="userId" type="hidden" value={userId} />
        <input
          aria-label="New password"
          autoComplete="new-password"
          className="min-h-10 w-48 rounded border border-[var(--border)] px-2 text-xs"
          minLength={8}
          name="newPassword"
          placeholder="New password"
          required
          type="password"
        />
        <input
          aria-label="Confirm new password"
          autoComplete="new-password"
          className="min-h-10 w-48 rounded border border-[var(--border)] px-2 text-xs"
          minLength={8}
          name="confirmPassword"
          placeholder="Confirm password"
          required
          type="password"
        />
        <button
          className="block min-h-10 rounded border border-[var(--border)] px-3 text-xs font-semibold disabled:opacity-60"
          disabled={pending}
          type="submit"
        >
          {pending ? "Resetting…" : "Reset password"}
        </button>
        {state.message && (
          <p className="max-w-48 text-xs" role={state.status === "error" ? "alert" : "status"}>
            {state.message}
          </p>
        )}
      </form>
    </details>
  );
}
