import { describe, expect, it, vi } from "vitest";

import type { ApplicationPrincipal } from "../domain/principal";
import {
  changeOwnLoginEmail,
  changeOwnPassword,
  updateOwnDisplayName,
  type AccountSecurityStore,
} from "./manage-account-security";

const user: ApplicationPrincipal = {
  id: "user-1",
  name: "Old Name",
  email: "owner@example.com",
  active: true,
  roleCodes: ["SUPER_ADMIN"],
  permissions: [],
};

describe("account security", () => {
  it("trims and updates the authenticated user's display name without accepting identity from input", async () => {
    // Defect caught: a profile update could retain whitespace or update a client-selected user.
    const store: AccountSecurityStore = {
      updateDisplayName: vi.fn(async () => undefined),
      changeLoginEmail: vi.fn(async () => "updated" as const),
      changePassword: vi.fn(async () => "updated" as const),
    };

    await expect(updateOwnDisplayName(user, "  Factory Owner  ", store)).resolves.toEqual({
      ok: true,
    });
    expect(store.updateDisplayName).toHaveBeenCalledWith("user-1", "Factory Owner");
  });

  it("normalizes a new login email and requires the current password for the authenticated user", async () => {
    // Defect caught: login email changes could skip password confirmation or target a supplied user ID.
    const store: AccountSecurityStore = {
      updateDisplayName: vi.fn(async () => undefined),
      changeLoginEmail: vi.fn(async () => "updated" as const),
      changePassword: vi.fn(async () => "updated" as const),
    };

    await expect(
      changeOwnLoginEmail(user, "  NEW.LOGIN@Example.COM ", "current-password", store),
    ).resolves.toEqual({ ok: true });
    expect(store.changeLoginEmail).toHaveBeenCalledWith(
      "user-1",
      "new.login@example.com",
      "current-password",
    );
  });

  it("changes the authenticated user's password only when confirmation matches", async () => {
    // Defect caught: a password typo could be committed or the client could select another account.
    const store: AccountSecurityStore = {
      updateDisplayName: vi.fn(async () => undefined),
      changeLoginEmail: vi.fn(async () => "updated" as const),
      changePassword: vi.fn(async () => "updated" as const),
    };

    await expect(
      changeOwnPassword(
        user,
        "current-password",
        "replacement-password",
        "replacement-password",
        store,
      ),
    ).resolves.toEqual({ ok: true });
    expect(store.changePassword).toHaveBeenCalledWith(
      "user-1",
      "current-password",
      "replacement-password",
    );
  });
});
