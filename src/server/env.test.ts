import { describe, expect, it } from "vitest";

import { parseServerEnv } from "./env";

describe("parseServerEnv", () => {
  it("identifies DATABASE_URL when mandatory database configuration is missing", () => {
    // Defect caught: a server could otherwise start without database configuration.
    expect(() => parseServerEnv({ APP_ENV: "development" })).toThrowError(/DATABASE_URL/);
  });

  it("rejects startup when Better Auth configuration is missing", () => {
    // Defect caught: authentication could otherwise start with an unknown secret or origin.
    expect(() =>
      parseServerEnv({
        APP_ENV: "development",
        DATABASE_URL: "postgresql://factory_app:password@localhost:5432/factory_erp",
      }),
    ).toThrowError(/BETTER_AUTH_SECRET/);
  });

  it("rejects a non-HTTP Better Auth URL", () => {
    // Defect caught: invalid callback origins could produce unsafe or unusable auth redirects.
    expect(() =>
      parseServerEnv({
        APP_ENV: "development",
        DATABASE_URL: "postgresql://factory_app:password@localhost:5432/factory_erp",
        BETTER_AUTH_SECRET: "a".repeat(32),
        BETTER_AUTH_URL: "ftp://localhost:3000",
      }),
    ).toThrowError(/BETTER_AUTH_URL/);
  });

  it("accepts a native loopback PostgreSQL URL in production", () => {
    // Defect caught: the native Windows host could otherwise reject its own local PostgreSQL service.
    expect(
      parseServerEnv({
        APP_ENV: "production",
        DATABASE_URL: "postgresql://factory_app:password@127.0.0.1:5432/factory_erp",
        BETTER_AUTH_SECRET: "a".repeat(32),
        BETTER_AUTH_URL: "http://127.0.0.1:3000",
      }),
    ).toMatchObject({ APP_ENV: "production" });
  });

  it("rejects the superseded Compose database hostname in production", () => {
    // Defect caught: an app running natively would fail to reach the retired Compose-only hostname.
    expect(() =>
      parseServerEnv({
        APP_ENV: "production",
        DATABASE_URL: "postgresql://factory_app:password@database:5432/factory_erp",
        BETTER_AUTH_SECRET: "a".repeat(32),
        BETTER_AUTH_URL: "http://127.0.0.1:3000",
      }),
    ).toThrowError(/DATABASE_URL/);
  });

  it("rejects a remote PostgreSQL host in production", () => {
    // Defect caught: client devices or public networks could otherwise reach the database host directly.
    expect(() =>
      parseServerEnv({
        APP_ENV: "production",
        DATABASE_URL: "postgresql://factory_app:password@10.0.0.25:5432/factory_erp",
        BETTER_AUTH_SECRET: "a".repeat(32),
        BETTER_AUTH_URL: "http://127.0.0.1:3000",
      }),
    ).toThrowError(/DATABASE_URL/);
  });

  it("rejects a non-loopback HTTP Better Auth URL in production", () => {
    // Defect caught: plain HTTP callback traffic could otherwise leave the factory server.
    expect(() =>
      parseServerEnv({
        APP_ENV: "production",
        DATABASE_URL: "postgresql://factory_app:password@localhost:5432/factory_erp",
        BETTER_AUTH_SECRET: "a".repeat(32),
        BETTER_AUTH_URL: "http://factory.example.test:3000",
      }),
    ).toThrowError(/BETTER_AUTH_URL/);
  });

  it("accepts an HTTPS Better Auth origin in production for a later private origin", () => {
    // Defect caught: an otherwise safe HTTPS private-origin rollout could be blocked by Phase 30 validation.
    expect(
      parseServerEnv({
        APP_ENV: "production",
        DATABASE_URL: "postgresql://factory_app:password@[::1]:5432/factory_erp",
        BETTER_AUTH_SECRET: "a".repeat(32),
        BETTER_AUTH_URL: "https://factory.tailnet.example",
      }),
    ).toMatchObject({ APP_ENV: "production" });
  });
});
