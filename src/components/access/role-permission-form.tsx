"use client";

import { useActionState } from "react";

import {
  initialRoleActionState,
  replaceRolePermissionsAction,
} from "@/app/(erp)/administration/roles-permissions/actions";
import { PERMISSION_DESCRIPTIONS, PERMISSIONS } from "@/modules/access/domain/permissions";

export function RolePermissionForm({
  roleCode,
  assigned,
  protectedRole,
}: {
  roleCode: string;
  assigned: readonly string[];
  protectedRole: boolean;
}) {
  const [state, action, pending] = useActionState(
    replaceRolePermissionsAction,
    initialRoleActionState,
  );
  return (
    <form action={action} className="space-y-4">
      <input name="roleCode" type="hidden" value={roleCode} />
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {PERMISSIONS.map((permission) => (
          <label
            className="flex min-h-11 items-start gap-2 rounded-lg border border-[var(--border)] p-3 text-sm"
            key={permission}
          >
            <input
              defaultChecked={assigned.includes(permission)}
              disabled={protectedRole}
              name="permissionCodes"
              type="checkbox"
              value={permission}
            />
            <span>
              <strong className="block text-xs">{permission}</strong>
              <span className="text-xs text-[var(--muted)]">
                {PERMISSION_DESCRIPTIONS[permission]}
              </span>
            </span>
          </label>
        ))}
      </div>
      {protectedRole ? (
        <p className="text-sm text-[var(--muted)]">
          Protected: all permissions are enforced by the seed and cannot be edited.
        </p>
      ) : (
        <button
          className="min-h-11 rounded-lg bg-[var(--accent)] px-4 text-sm font-semibold text-white disabled:opacity-60"
          disabled={pending}
          type="submit"
        >
          {pending ? "Saving…" : "Save permissions"}
        </button>
      )}
      {state.message && (
        <p className="text-sm" role="status">
          {state.message}
        </p>
      )}
    </form>
  );
}
