import type { PermissionCode } from "../domain/permissions";

export type AccessSeedStore = {
  upsertPermission(input: { code: PermissionCode; description: string }): Promise<void>;
  upsertRole(input: { code: string; name: string; isProtected: boolean }): Promise<void>;
  replaceRolePermissions(roleCode: string, permissions: readonly PermissionCode[]): Promise<void>;
};

export type BootstrapUser = { id: string; email: string; active: boolean };

export type BootstrapStore = {
  findUserByEmail(email: string): Promise<BootstrapUser | null>;
  createCredentialUser(input: {
    name: string;
    email: string;
    password: string;
  }): Promise<BootstrapUser>;
  setUserActive(userId: string, active: boolean): Promise<void>;
  ensureUserRole(userId: string, roleCode: string): Promise<void>;
};
