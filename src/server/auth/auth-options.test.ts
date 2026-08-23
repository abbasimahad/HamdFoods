import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { describe, expect, it } from "vitest";

import { createAuthOptions } from "./auth-options";
import { createActiveSessionBeforeHook } from "./active-session-policy";

describe("Better Auth options", () => {
  it("rejects the public email signup endpoint", async () => {
    // Defect caught: enabling credentials could accidentally expose public self-registration.
    const auth = betterAuth({
      ...createAuthOptions(),
      database: memoryAdapter({ user: [], session: [], account: [], verification: [] }),
      baseURL: "http://localhost:3000",
      secret: "test-only-secret-at-least-32-characters-long",
    });

    const response = await auth.handler(
      new Request("http://localhost:3000/api/auth/sign-up/email", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "Public User",
          email: "public@example.com",
          password: "password123",
        }),
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: "EMAIL_PASSWORD_SIGN_UP_DISABLED",
    });
  });

  it("uses Better Auth hashing and accepts only the valid password", async () => {
    // Defect caught: internal provisioning could bypass Better Auth hashing or break credential login.
    const database: Record<string, Record<string, unknown>[]> = {
      user: [],
      session: [],
      account: [],
      verification: [],
    };
    const shared = {
      database: memoryAdapter(database),
      baseURL: "http://localhost:3000",
      secret: "test-only-secret-at-least-32-characters-long",
    };
    const provisioningAuth = betterAuth({ ...createAuthOptions({ allowSignUp: true }), ...shared });
    const publicAuth = betterAuth({ ...createAuthOptions(), ...shared });

    await provisioningAuth.api.signUpEmail({
      body: { name: "Valid User", email: "valid@example.com", password: "password123" },
    });

    const account = database.account?.[0];
    expect(account?.password).not.toBe("password123");
    await expect(
      publicAuth.api.signInEmail({
        body: { email: "valid@example.com", password: "password123" },
      }),
    ).resolves.toMatchObject({ user: { email: "valid@example.com" } });
    await expect(
      publicAuth.api.signInEmail({
        body: { email: "valid@example.com", password: "wrong-password" },
      }),
    ).rejects.toThrow();
  });

  it("rejects credential sign-in when the production active-session policy denies creation", async () => {
    const database: Record<string, Record<string, unknown>[]> = {
      user: [],
      session: [],
      account: [],
      verification: [],
    };
    const shared = {
      database: memoryAdapter(database),
      baseURL: "http://localhost:3000",
      secret: "test-only-secret-at-least-32-characters-long",
    };
    const provisioningAuth = betterAuth({ ...createAuthOptions({ allowSignUp: true }), ...shared });
    const publicAuth = betterAuth({
      ...createAuthOptions(),
      ...shared,
      databaseHooks: {
        session: { create: { before: createActiveSessionBeforeHook(async () => false) } },
      },
    });
    await provisioningAuth.api.signUpEmail({
      body: { name: "Inactive User", email: "inactive@example.com", password: "password123" },
    });

    await expect(
      publicAuth.api.signInEmail({
        body: { email: "inactive@example.com", password: "password123" },
      }),
    ).rejects.toThrow();
    expect(database.session).toHaveLength(0);
  });

  it("invalidates the current session through the logout endpoint", async () => {
    const database: Record<string, Record<string, unknown>[]> = {
      user: [],
      session: [],
      account: [],
      verification: [],
    };
    const shared = {
      database: memoryAdapter(database),
      baseURL: "http://localhost:3000",
      secret: "test-only-secret-at-least-32-characters-long",
    };
    const provisioningAuth = betterAuth({ ...createAuthOptions({ allowSignUp: true }), ...shared });
    const publicAuth = betterAuth({ ...createAuthOptions(), ...shared });
    await provisioningAuth.api.signUpEmail({
      body: { name: "Logout User", email: "logout@example.com", password: "password123" },
    });
    const signInResponse = await publicAuth.handler(
      new Request("http://localhost:3000/api/auth/sign-in/email", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "logout@example.com", password: "password123" }),
      }),
    );
    const cookie = signInResponse.headers.get("set-cookie")?.split(";", 1)[0];
    expect(cookie).toBeTruthy();
    expect(database.session).toHaveLength(1);

    const signOutResponse = await publicAuth.handler(
      new Request("http://localhost:3000/api/auth/sign-out", {
        method: "POST",
        headers: { cookie: cookie ?? "" },
      }),
    );
    expect(signOutResponse.ok).toBe(true);
    expect(database.session).toHaveLength(0);
  });
});
