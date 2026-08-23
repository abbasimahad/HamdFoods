"use client";

import { useActionState } from "react";
import {
  initialUserActionState,
  replaceUserRolesAction,
} from "@/app/(erp)/administration/users/actions";

export function UserRoleForm({
  userId,
  assigned,
  roles,
}: {
  userId: string;
  assigned: readonly string[];
  roles: readonly { code: string; name: string }[];
}) {
  const [state, action, pending] = useActionState(replaceUserRolesAction, initialUserActionState);
  return (
    <form action={action} className="space-y-2">
      <input name="userId" type="hidden" value={userId} />
      <div className="flex flex-wrap gap-2">
        {roles.map((role) => (
          <label className="text-xs" key={role.code}>
            <input
              defaultChecked={assigned.includes(role.code)}
              className="mr-1"
              name="roleCodes"
              type="checkbox"
              value={role.code}
            />
            {role.name}
          </label>
        ))}
      </div>
      <button
        className="rounded border border-[var(--border)] px-3 py-2 text-xs font-semibold disabled:opacity-60"
        disabled={pending}
        type="submit"
      >
        {pending ? "Saving…" : "Save roles"}
      </button>
      {state.message && (
        <p className="text-xs" role="status">
          {state.message}
        </p>
      )}
    </form>
  );
}
