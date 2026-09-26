"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";

import {
  changeLoginEmailAction,
  changePasswordAction,
  updateDisplayNameAction,
} from "@/app/(erp)/account/security/actions";
import {
  initialAccountSecurityState,
  type AccountSecurityActionState,
} from "@/components/auth/account-security-state";

const inputClass = "mt-1 min-h-11 w-full rounded-lg border border-[var(--border)] px-3";
const buttonClass =
  "min-h-11 rounded-lg bg-[var(--accent)] px-4 font-semibold text-white disabled:opacity-60";

export function DisplayNameForm({ currentName }: { currentName: string }) {
  const [state, action, pending] = useActionState(
    updateDisplayNameAction,
    initialAccountSecurityState,
  );
  return (
    <form action={action} className="space-y-4">
      <label className="block text-sm font-medium">
        Display Name
        <input
          className={inputClass}
          defaultValue={currentName}
          maxLength={120}
          name="displayName"
          required
        />
      </label>
      <ActionMessage state={state} />
      <button className={buttonClass} disabled={pending} type="submit">
        {pending ? "Saving…" : "Save display name"}
      </button>
    </form>
  );
}

export function LoginEmailForm({ currentEmail }: { currentEmail: string }) {
  const [state, action, pending] = useActionState(
    changeLoginEmailAction,
    initialAccountSecurityState,
  );
  useSignedOutRedirect(state);
  return (
    <form action={action} className="space-y-4">
      <p className="text-sm text-[var(--muted)]">Current login: {currentEmail}</p>
      <label className="block text-sm font-medium">
        New Login Email
        <input autoComplete="email" className={inputClass} name="newEmail" required type="email" />
      </label>
      <label className="block text-sm font-medium">
        Current Password
        <input
          autoComplete="current-password"
          className={inputClass}
          name="currentPassword"
          required
          type="password"
        />
      </label>
      <ActionMessage state={state} />
      <button className={buttonClass} disabled={pending} type="submit">
        {pending ? "Changing…" : "Change login email"}
      </button>
    </form>
  );
}

export function ChangePasswordForm() {
  const [state, action, pending] = useActionState(
    changePasswordAction,
    initialAccountSecurityState,
  );
  useSignedOutRedirect(state);
  return (
    <form action={action} className="space-y-4">
      <label className="block text-sm font-medium">
        Current Password
        <input
          autoComplete="current-password"
          className={inputClass}
          name="currentPassword"
          required
          type="password"
        />
      </label>
      <label className="block text-sm font-medium">
        New Password
        <input
          autoComplete="new-password"
          className={inputClass}
          minLength={8}
          name="newPassword"
          required
          type="password"
        />
      </label>
      <label className="block text-sm font-medium">
        Confirm New Password
        <input
          autoComplete="new-password"
          className={inputClass}
          minLength={8}
          name="confirmPassword"
          required
          type="password"
        />
      </label>
      <ActionMessage state={state} />
      <button className={buttonClass} disabled={pending} type="submit">
        {pending ? "Changing…" : "Change password"}
      </button>
    </form>
  );
}

function ActionMessage({ state }: { state: AccountSecurityActionState }) {
  if (!state.message) return null;
  return (
    <p
      className={
        state.status === "error" ? "text-sm text-[var(--danger)]" : "text-sm text-[var(--success)]"
      }
      role={state.status === "error" ? "alert" : "status"}
    >
      {state.message}
    </p>
  );
}

function useSignedOutRedirect(state: AccountSecurityActionState) {
  const router = useRouter();
  useEffect(() => {
    if (state.signedOut) router.replace("/login");
  }, [router, state.signedOut]);
}
