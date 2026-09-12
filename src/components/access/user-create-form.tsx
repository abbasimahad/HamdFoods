"use client";
import { useActionState } from "react";
import { createUserAction, initialUserActionState } from "@/app/(erp)/administration/users/actions";
import { ActionFeedback } from "@/components/ui/action-feedback";
import { FormActions } from "@/components/ui/form-actions";
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
      <FormActions
        disabled={pending}
        onCancel={(event) => event.currentTarget.form?.reset()}
        pendingLabel="Creating…"
        submitLabel="Create user"
      />
      <ActionFeedback message={state.message} ok={state.status === "success"} />
    </form>
  );
}
