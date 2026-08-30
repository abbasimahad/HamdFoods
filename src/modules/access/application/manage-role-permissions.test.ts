import { describe, expect, it, vi } from "vitest";

import type { ApplicationPrincipal } from "../domain/principal";
import { replaceRolePermissions, type RolePermissionStore } from "./manage-role-permissions";

const actor: ApplicationPrincipal = {
  id: "admin",
  name: "Admin",
  email: "admin@example.com",
  active: true,
  roleCodes: ["ADMIN"],
  permissions: ["roles.manage"],
};

describe("role permission administration", () => {
  it("requires roles.manage", async () => {
    const store: RolePermissionStore = {
      roleExists: vi.fn(async () => true),
      replaceRolePermissions: vi.fn(async () => undefined),
    };
    await expect(
      replaceRolePermissions({ ...actor, permissions: [] }, "VIEWER", ["dashboard.view"], store),
    ).resolves.toEqual({ ok: false, reason: "forbidden" });
  });

  it("rejects unknown codes and immutable SUPER_ADMIN mappings", async () => {
    const store: RolePermissionStore = {
      roleExists: vi.fn(async () => true),
      replaceRolePermissions: vi.fn(async () => undefined),
    };
    await expect(replaceRolePermissions(actor, "VIEWER", ["unknown"], store)).resolves.toEqual({
      ok: false,
      reason: "invalid-permission",
    });
    await expect(
      replaceRolePermissions(actor, "SUPER_ADMIN", ["dashboard.view"], store),
    ).resolves.toEqual({ ok: false, reason: "protected-role" });
  });

  it("normalizes duplicates before transactional replacement", async () => {
    const store: RolePermissionStore = {
      roleExists: vi.fn(async () => true),
      replaceRolePermissions: vi.fn(async () => undefined),
    };
    await expect(
      replaceRolePermissions(
        actor,
        "VIEWER",
        ["dashboard.view", "dashboard.view", "reports.view"],
        store,
      ),
    ).resolves.toEqual({ ok: true });
    expect(store.replaceRolePermissions).toHaveBeenCalledWith("admin", "VIEWER", [
      "dashboard.view",
      "reports.view",
    ]);
  });
});
