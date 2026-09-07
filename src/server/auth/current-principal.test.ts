import { describe, expect, it, vi } from "vitest";

import type { ApplicationPrincipal } from "@/modules/access/domain/principal";
import { hasPermission } from "@/modules/access/domain/principal";
import { PERMISSIONS } from "@/modules/access/domain/permissions";

import { resolveCurrentPrincipal } from "./current-principal";

const activePrincipal: ApplicationPrincipal = {
  id: "user-1",
  name: "Operator",
  email: "operator@example.com",
  active: true,
  roleCodes: ["SALES"],
  permissions: ["dashboard.view", "sales.view"],
};

describe("resolveCurrentPrincipal", () => {
  it("resolves an in-memory development SUPER_ADMIN without a session or database lookup", async () => {
    // Defect caught: development bypass could still require a Better Auth session or create a database user.
    const loadPrincipal = vi.fn();
    const revokeUserSessions = vi.fn();
    const resolution = await resolveCurrentPrincipal(
      null,
      { loadPrincipal, revokeUserSessions },
      { authenticationBypassEnabled: true },
    );

    expect(resolution).toEqual({
      kind: "active",
      principal: {
        id: "dev-auth-bypass",
        name: "Development Factory Owner",
        email: "dev-auth-bypass@hamdfoods.local",
        active: true,
        roleCodes: ["SUPER_ADMIN"],
        permissions: PERMISSIONS,
      },
    });
    expect(loadPrincipal).not.toHaveBeenCalled();
    expect(revokeUserSessions).not.toHaveBeenCalled();
  });

  it("keeps centralized permission checks active for the development principal", async () => {
    // Defect caught: bypass mode could short-circuit authorization instead of supplying a principal to RBAC.
    const resolution = await resolveCurrentPrincipal(
      null,
      { loadPrincipal: vi.fn(), revokeUserSessions: vi.fn() },
      { authenticationBypassEnabled: true },
    );
    expect(resolution.kind).toBe("active");
    if (resolution.kind !== "active") throw new Error("Expected active development principal.");
    expect(PERMISSIONS.every((permission) => hasPermission(resolution.principal, permission))).toBe(
      true,
    );
    expect(hasPermission(resolution.principal, "dashboard.view")).toBe(true);
  });

  it("rejects an unauthenticated request without querying users", async () => {
    // Defect caught: missing session state could otherwise fall through to protected content.
    const loadPrincipal = vi.fn();
    await expect(
      resolveCurrentPrincipal(null, { loadPrincipal, revokeUserSessions: vi.fn() }),
    ).resolves.toEqual({ kind: "unauthenticated" });
    expect(loadPrincipal).not.toHaveBeenCalled();
  });

  it("reloads the principal on every call", async () => {
    // Defect caught: role changes could remain stale in a browser session.
    const loadPrincipal = vi.fn().mockResolvedValue(activePrincipal);
    const dependencies = { loadPrincipal, revokeUserSessions: vi.fn() };
    await resolveCurrentPrincipal({ userId: "user-1" }, dependencies);
    await resolveCurrentPrincipal({ userId: "user-1" }, dependencies);
    expect(loadPrincipal).toHaveBeenCalledTimes(2);
  });

  it("revokes sessions and rejects an inactive database user", async () => {
    // Defect caught: a pre-existing session could survive account deactivation.
    const revokeUserSessions = vi.fn().mockResolvedValue(undefined);
    await expect(
      resolveCurrentPrincipal(
        { userId: "user-1" },
        {
          loadPrincipal: vi.fn().mockResolvedValue({ ...activePrincipal, active: false }),
          revokeUserSessions,
        },
      ),
    ).resolves.toEqual({ kind: "inactive" });
    expect(revokeUserSessions).toHaveBeenCalledWith("user-1");
  });

  it("returns the freshly loaded active principal", async () => {
    // Defect caught: valid users could be rejected after successful session resolution.
    await expect(
      resolveCurrentPrincipal(
        { userId: "user-1" },
        {
          loadPrincipal: vi.fn().mockResolvedValue(activePrincipal),
          revokeUserSessions: vi.fn(),
        },
      ),
    ).resolves.toEqual({ kind: "active", principal: activePrincipal });
  });
});
