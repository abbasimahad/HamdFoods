import { describe, expect, it, vi } from "vitest";

import type { ApplicationPrincipal } from "@/modules/access/domain/principal";

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
