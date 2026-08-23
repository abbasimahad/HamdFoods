import { describe, expect, it, vi } from "vitest";

import { authenticateUser, type AuthenticationGateway } from "./authenticate-user";

function gateway(overrides: Partial<AuthenticationGateway> = {}): AuthenticationGateway {
  return {
    signIn: vi.fn().mockResolvedValue({ userId: "user-1" }),
    isActive: vi.fn().mockResolvedValue(true),
    revokeCurrentSession: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe("authenticateUser", () => {
  it("allows valid credentials for an active user", async () => {
    // Defect caught: successful Better Auth credentials could be discarded by application orchestration.
    await expect(
      authenticateUser(
        { email: "user@example.com", password: "password123", rememberMe: true },
        gateway(),
      ),
    ).resolves.toEqual({ ok: true });
  });

  it("returns one generic error for invalid credentials and dependency failures", async () => {
    // Defect caught: distinct errors could reveal whether an email exists.
    const invalid = gateway({ signIn: vi.fn().mockResolvedValue(null) });
    const failed = gateway({ signIn: vi.fn().mockRejectedValue(new Error("database detail")) });
    await expect(
      authenticateUser(
        { email: "missing@example.com", password: "wrong-pass", rememberMe: false },
        invalid,
      ),
    ).resolves.toEqual({ ok: false, message: "Invalid email or password." });
    await expect(
      authenticateUser(
        { email: "missing@example.com", password: "wrong-pass", rememberMe: false },
        failed,
      ),
    ).resolves.toEqual({ ok: false, message: "Invalid email or password." });
  });

  it("revokes the new session and returns the generic error for an inactive user", async () => {
    // Defect caught: correct credentials could leave an inactive user with a usable session.
    const inactive = gateway({ isActive: vi.fn().mockResolvedValue(false) });
    await expect(
      authenticateUser(
        { email: "inactive@example.com", password: "password123", rememberMe: false },
        inactive,
      ),
    ).resolves.toEqual({ ok: false, message: "Invalid email or password." });
    expect(inactive.revokeCurrentSession).toHaveBeenCalledOnce();
  });
});
