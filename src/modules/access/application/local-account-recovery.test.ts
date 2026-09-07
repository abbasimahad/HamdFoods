import { describe, expect, it, vi } from "vitest";

import {
  listLocalRecoveryAccounts,
  recoverLocalAdministrativeAccount,
  type LocalAccountRecoveryStore,
} from "./local-account-recovery";

describe("local account recovery", () => {
  it("returns only safe administrative account discovery metadata", async () => {
    // Defect caught: local discovery could omit the recoverable admin or expose credential/session fields.
    const store: LocalAccountRecoveryStore = {
      listAdministrativeAccounts: vi.fn(async () => [
        {
          id: "owner-1",
          displayName: "Factory Owner",
          loginEmail: "owner@example.com",
          roleCodes: ["SUPER_ADMIN"],
          status: "Active" as const,
        },
      ]),
      recoverAdministrativeAccount: vi.fn(async () => "updated" as const),
    };

    const accounts = await listLocalRecoveryAccounts(store);
    expect(accounts).toEqual([
      {
        id: "owner-1",
        displayName: "Factory Owner",
        loginEmail: "owner@example.com",
        roleCodes: ["SUPER_ADMIN"],
        status: "Active",
      },
    ]);
    expect(JSON.stringify(accounts)).not.toMatch(/password|hash|token|database_url|secret/i);
  });

  it("changes both login email and password without returning either credential", async () => {
    // Defect caught: local recovery could fail to normalize the email or leak the submitted password.
    const store: LocalAccountRecoveryStore = {
      listAdministrativeAccounts: vi.fn(async () => []),
      recoverAdministrativeAccount: vi.fn(async () => "updated" as const),
    };

    const result = await recoverLocalAdministrativeAccount(store, {
      userId: "owner-1",
      loginEmail: "  OWNER.NEW@Example.COM ",
      password: "replacement-password",
      confirmedPassword: "replacement-password",
    });

    expect(result).toEqual({ ok: true });
    expect(store.recoverAdministrativeAccount).toHaveBeenCalledWith("owner-1", {
      loginEmail: "owner.new@example.com",
      password: "replacement-password",
    });
    expect(JSON.stringify(result)).not.toContain("replacement-password");
  });

  it("rejects empty recovery and mismatched passwords before calling the store", async () => {
    const store: LocalAccountRecoveryStore = {
      listAdministrativeAccounts: vi.fn(async () => []),
      recoverAdministrativeAccount: vi.fn(async () => "updated" as const),
    };

    await expect(recoverLocalAdministrativeAccount(store, { userId: "owner-1" })).resolves.toEqual({
      ok: false,
      reason: "invalid-request",
    });
    await expect(
      recoverLocalAdministrativeAccount(store, {
        userId: "owner-1",
        password: "replacement-password",
        confirmedPassword: "different-password",
      }),
    ).resolves.toEqual({ ok: false, reason: "password-mismatch" });
    expect(store.recoverAdministrativeAccount).not.toHaveBeenCalled();
  });
});
