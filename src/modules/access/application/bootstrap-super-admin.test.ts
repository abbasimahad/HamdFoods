import { describe, expect, it } from "vitest";

import type { BootstrapStore, BootstrapUser } from "./ports";
import { bootstrapSuperAdmin } from "./bootstrap-super-admin";

class MemoryBootstrapStore implements BootstrapStore {
  user: BootstrapUser | null = null;
  createdPasswords: string[] = [];
  roles = new Set<string>();
  async findUserByEmail(email: string) {
    return this.user?.email === email ? this.user : null;
  }
  async createCredentialUser(input: { email: string; password: string }) {
    this.createdPasswords.push(input.password);
    this.user = { id: "user-1", email: input.email, active: true };
    return this.user;
  }
  async setUserActive(_userId: string, active: boolean) {
    if (this.user) this.user.active = active;
  }
  async ensureUserRole(_userId: string, roleCode: string) {
    this.roles.add(roleCode);
  }
}

describe("bootstrapSuperAdmin", () => {
  it("creates once, preserves the password on rerun, and restores required access", async () => {
    // Defect caught: reruns could duplicate administrators or silently reset a production password.
    const store = new MemoryBootstrapStore();
    const input = {
      name: "Factory Owner",
      email: "OWNER@EXAMPLE.COM",
      password: "temporary-password",
    };
    await expect(bootstrapSuperAdmin(input, store)).resolves.toEqual({
      userId: "user-1",
      created: true,
    });
    if (store.user) store.user.active = false;
    await expect(
      bootstrapSuperAdmin({ ...input, password: "different-password" }, store),
    ).resolves.toEqual({ userId: "user-1", created: false });
    expect(store.createdPasswords).toEqual(["temporary-password"]);
    expect(store.user?.active).toBe(true);
    expect(store.roles).toEqual(new Set(["SUPER_ADMIN"]));
  });
});
