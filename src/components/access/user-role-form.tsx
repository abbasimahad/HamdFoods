"use client";
import { useActionState } from "react";
import {
  initialUserActionState,
  replaceUserRolesAction,
} from "@/app/(erp)/administration/users/actions";
import { ActionFeedback } from "@/components/ui/action-feedback";
import { FormActions } from "@/components/ui/form-actions";
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
      <FormActions
        disabled={pending}
        onCancel={(event) => event.currentTarget.form?.reset()}
        pendingLabel="Saving…"
        submitLabel="Save roles"
      />
      <ActionFeedback message={state.message} ok={state.status === "success"} />
    </form>
  );
}
