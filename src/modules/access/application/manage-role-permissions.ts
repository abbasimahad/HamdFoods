import { isPermissionCode, type PermissionCode } from "../domain/permissions";
import { hasPermission, type ApplicationPrincipal } from "../domain/principal";

export type RolePermissionStore = {
  roleExists(roleCode: string): Promise<boolean>;
  replaceRolePermissions(
    actorId: string,
    roleCode: string,
    permissions: readonly PermissionCode[],
  ): Promise<void>;
};

export type RolePermissionResult =
  | { ok: true }
  | { ok: false; reason: "forbidden" | "invalid-permission" | "protected-role" | "not-found" };

export async function replaceRolePermissions(
  actor: ApplicationPrincipal,
  roleCode: string,
  submittedCodes: readonly string[],
  store: RolePermissionStore,
): Promise<RolePermissionResult> {
  if (!hasPermission(actor, "roles.manage")) return { ok: false, reason: "forbidden" };
  if (roleCode === "SUPER_ADMIN") return { ok: false, reason: "protected-role" };
  if (!submittedCodes.every(isPermissionCode)) return { ok: false, reason: "invalid-permission" };
  if (!(await store.roleExists(roleCode))) return { ok: false, reason: "not-found" };
  const permissions = [...new Set(submittedCodes)] as PermissionCode[];
  await store.replaceRolePermissions(actor.id, roleCode, permissions);
  return { ok: true };
}
