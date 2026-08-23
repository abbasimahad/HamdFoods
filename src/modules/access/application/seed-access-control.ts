import {
  DEFAULT_ROLE_CODES,
  DEFAULT_ROLE_NAMES,
  DEFAULT_ROLE_PERMISSIONS,
} from "../domain/default-roles";
import { PERMISSIONS, PERMISSION_DESCRIPTIONS } from "../domain/permissions";
import type { AccessSeedStore } from "./ports";

export async function seedAccessControl(store: AccessSeedStore): Promise<void> {
  for (const code of PERMISSIONS) {
    await store.upsertPermission({ code, description: PERMISSION_DESCRIPTIONS[code] });
  }
  for (const code of DEFAULT_ROLE_CODES) {
    await store.upsertRole({
      code,
      name: DEFAULT_ROLE_NAMES[code],
      isProtected: code === "SUPER_ADMIN",
    });
    await store.replaceRolePermissions(code, DEFAULT_ROLE_PERMISSIONS[code]);
  }
}
