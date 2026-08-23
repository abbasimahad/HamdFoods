import { describe, expect, it } from "vitest";

import type { PermissionCode } from "../domain/permissions";
import type { AccessSeedStore } from "./ports";
import { seedAccessControl } from "./seed-access-control";

class MemorySeedStore implements AccessSeedStore {
  permissions = new Set<string>();
  roles = new Set<string>();
  mappings = new Map<string, readonly PermissionCode[]>();
  async upsertPermission(input: { code: PermissionCode }) {
    this.permissions.add(input.code);
  }
  async upsertRole(input: { code: string }) {
    this.roles.add(input.code);
  }
  async replaceRolePermissions(roleCode: string, permissions: readonly PermissionCode[]) {
    this.mappings.set(roleCode, [...permissions]);
  }
}

describe("seedAccessControl", () => {
  it("reconciles every default record and mapping idempotently", async () => {
    // Defect caught: rerunning a deployment seed could duplicate or drift RBAC mappings.
    const store = new MemorySeedStore();
    await seedAccessControl(store);
    await seedAccessControl(store);
    expect(store.permissions.size).toBe(16);
    expect(store.roles.size).toBe(7);
    expect(store.mappings.get("SALES")).toEqual(["dashboard.view", "sales.view", "sales.manage"]);
    expect(store.mappings.get("SUPER_ADMIN")?.length).toBe(16);
  });
});
