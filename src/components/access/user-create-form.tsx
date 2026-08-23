"use client";

import { useActionState } from "react";

import { createUserAction, initialUserActionState } from "@/app/(erp)/administration/users/actions";

export function UserCreateForm({ roles }: { roles: readonly { code: string; name: string }[] }) {
  const [state, action, pending] = useActionState(createUserAction, initialUserActionState);
  return (
    <form action={action} className="grid gap-4 md:grid-cols-2">
      <label className="text-sm font-medium">
        Name
        <input
          className="mt-1 min-h-11 w-full rounded-lg border border-[var(--border)] px-3"
          name="name"
          required
        />
      </label>
      <label className="text-sm font-medium">
        Email
        <input
          className="mt-1 min-h-11 w-full rounded-lg border border-[var(--border)] px-3"
          name="email"
          required
          type="email"
        />
      </label>
      <label className="text-sm font-medium">
        Initial password
        <input
          className="mt-1 min-h-11 w-full rounded-lg border border-[var(--border)] px-3"
          minLength={8}
          name="password"
          required
          type="password"
        />
      </label>
      <fieldset>
        <legend className="text-sm font-medium">Roles</legend>
        <div className="mt-1 flex flex-wrap gap-3">
          {roles.map((role) => (
            <label className="flex min-h-11 items-center gap-2 text-sm" key={role.code}>
              <input name="roleCodes" type="checkbox" value={role.code} />
              {role.name}
            </label>
          ))}
        </div>
      </fieldset>
      <label className="flex min-h-11 items-center gap-2 text-sm">
        <input defaultChecked name="active" type="checkbox" /> Active immediately
      </label>
      <div className="flex items-center gap-3">
        <button
          className="min-h-11 rounded-lg bg-[var(--accent)] px-4 text-sm font-semibold text-white disabled:opacity-60"
          disabled={pending}
          type="submit"
        >
          {pending ? "Creating…" : "Create user"}
        </button>
        {state.message && (
          <p
            className={`text-sm ${state.status === "error" ? "text-[var(--danger-ink)]" : "text-[var(--success-ink)]"}`}
            role="status"
          >
            {state.message}
          </p>
        )}
      </div>
    </form>
  );
}
