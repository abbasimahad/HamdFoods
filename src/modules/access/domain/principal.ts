import type { PermissionCode } from "./permissions";

export type ApplicationPrincipal = {
  id: string;
  name: string;
  email: string;
  active: boolean;
  roleCodes: readonly string[];
  permissions: readonly PermissionCode[];
};

export function hasPermission(_principal: ApplicationPrincipal, _permission: PermissionCode) {
  return _principal.active && _principal.permissions.includes(_permission);
}
