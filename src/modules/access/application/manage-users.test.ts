import { describe, expect, it, vi } from "vitest";

import type { ApplicationPrincipal } from "../domain/principal";
import {
  createManagedUser,
  replaceUserRoles,
  setUserActive,
  type UserManagementStore,
} from "./manage-users";

const admin: ApplicationPrincipal = {
  id: "admin",
  name: "Admin",
  email: "admin@example.com",
  active: true,
  roleCodes: ["ADMIN"],
  permissions: ["users.manage"],
};
const superAdmin = { ...admin, roleCodes: ["SUPER_ADMIN"] };

function store(): UserManagementStore {
  return {
    roleCodesExist: vi.fn(async () => true),
    createUser: vi.fn(async () => ({ id: "new", email: "new@example.com" })),
    replaceUserRolesPreservingSuperAdmin: vi.fn(async () => "updated" as const),
    getUserAccessState: vi.fn(async () => ({ active: true, roleCodes: ["VIEWER"] })),
    setUserActivePreservingSuperAdmin: vi.fn(async () => "updated" as const),
  };
}

describe("user administration", () => {
  it("rejects mutation without users.manage", async () => {
    const repository = store();
    await expect(
      createManagedUser(
        { ...admin, permissions: [] },
        {
          name: "New",
          email: "new@example.com",
          password: "password123",
          active: true,
          roleCodes: ["VIEWER"],
        },
        repository,
      ),
    ).resolves.toEqual({ ok: false, reason: "forbidden" });
    expect(repository.createUser).not.toHaveBeenCalled();
  });

  it("creates a user without retaining the password in the result", async () => {
    const repository = store();
    const result = await createManagedUser(
      admin,
      {
        name: "New",
        email: "NEW@EXAMPLE.COM",
        password: "password123",
        active: true,
        roleCodes: ["VIEWER"],
      },
      repository,
    );
    expect(result).toEqual({ ok: true, userId: "new" });
    expect(JSON.stringify(result)).not.toContain("password123");
  });

  it("allows only SUPER_ADMIN to assign SUPER_ADMIN", async () => {
    const repository = store();
    await expect(replaceUserRoles(admin, "target", ["SUPER_ADMIN"], repository)).resolves.toEqual({
      ok: false,
      reason: "protected-role",
    });
    await expect(
      replaceUserRoles(superAdmin, "target", ["SUPER_ADMIN"], repository),
    ).resolves.toEqual({ ok: true });
  });

  it("rejects self-demotion and removal of the last active SUPER_ADMIN", async () => {
    const repository = store();
    repository.getUserAccessState = vi.fn(async () => ({
      active: true,
      roleCodes: ["SUPER_ADMIN"],
    }));
    await expect(replaceUserRoles(superAdmin, "admin", ["VIEWER"], repository)).resolves.toEqual({
      ok: false,
      reason: "self-change",
    });
    repository.replaceUserRolesPreservingSuperAdmin = vi.fn(
      async () => "last-super-admin" as const,
    );
    await expect(replaceUserRoles(superAdmin, "other", ["VIEWER"], repository)).resolves.toEqual({
      ok: false,
      reason: "last-super-admin",
    });
  });

  it("rejects self-deactivation and revokes sessions when another user is deactivated", async () => {
    const repository = store();
    await expect(setUserActive(admin, "admin", false, repository)).resolves.toEqual({
      ok: false,
      reason: "self-change",
    });
    await expect(setUserActive(admin, "target", false, repository)).resolves.toEqual({ ok: true });
    expect(repository.setUserActivePreservingSuperAdmin).toHaveBeenCalledWith(
      "admin",
      "target",
      false,
    );
  });

  it("returns the atomic store safeguard result for the last active SUPER_ADMIN", async () => {
    const repository = store();
    repository.getUserAccessState = vi.fn(async () => ({
      active: true,
      roleCodes: ["SUPER_ADMIN"],
    }));
    repository.setUserActivePreservingSuperAdmin = vi.fn(async () => "last-super-admin" as const);
    await expect(setUserActive(superAdmin, "other", false, repository)).resolves.toEqual({
      ok: false,
      reason: "last-super-admin",
    });
  });
});
