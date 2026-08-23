import type { PermissionCode } from "../domain/permissions";

export function mergePermissions(_rolePermissions: readonly (readonly PermissionCode[])[]) {
  return [...new Set(_rolePermissions.flat())];
}
