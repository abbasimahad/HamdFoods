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
        BETTER_AUTH_URL: "http://127.0.0.1:3100",
        HOSTNAME: "127.0.0.1",
        PORT: "3100",
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
        BETTER_AUTH_URL: "http://127.0.0.1:3100",
        HOSTNAME: "127.0.0.1",
        PORT: "3100",
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
        BETTER_AUTH_URL: "http://127.0.0.1:3100",
        HOSTNAME: "127.0.0.1",
        PORT: "3100",
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
        HOSTNAME: "127.0.0.1",
        PORT: "3100",
      }),
    ).toThrowError(/BETTER_AUTH_URL/);
  });

  it("accepts an exact Tailscale HTTPS trusted origin in production", () => {
    // Defect caught: an exact tailnet origin could be blocked while preserving the local auth base URL.
    expect(
      parseServerEnv({
        APP_ENV: "production",
        DATABASE_URL: "postgresql://factory_app:password@[::1]:5432/factory_erp",
        BETTER_AUTH_SECRET: "a".repeat(32),
        BETTER_AUTH_URL: "http://[::1]:3100",
        BETTER_AUTH_TRUSTED_ORIGINS: "https://factory.example-tailnet.ts.net",
        HOSTNAME: "::1",
        PORT: "3100",
      }),
    ).toMatchObject({ APP_ENV: "production" });
  });

  it("rejects an unsafe production server bind before startup", () => {
    // Defect caught: the standalone server could otherwise bind to every network interface even though preflight was loopback-only.
    expect(() =>
      parseServerEnv({
        APP_ENV: "production",
        DATABASE_URL: "postgresql://factory_app:password@127.0.0.1:5432/factory_erp",
        BETTER_AUTH_SECRET: "a".repeat(32),
        BETTER_AUTH_URL: "http://127.0.0.1:3100",
        HOSTNAME: "0.0.0.0",
        PORT: "3100",
      }),
    ).toThrowError(/HOSTNAME/);
  });

  it("rejects a loopback Better Auth port that differs from the server port", () => {
    // Defect caught: Better Auth could trust a different origin from the live standalone listener.
    expect(() =>
      parseServerEnv({
        APP_ENV: "production",
        DATABASE_URL: "postgresql://factory_app:password@127.0.0.1:5432/factory_erp",
        BETTER_AUTH_SECRET: "a".repeat(32),
        BETTER_AUTH_URL: "http://127.0.0.1:3000",
        HOSTNAME: "127.0.0.1",
        PORT: "3100",
      }),
    ).toThrowError(/BETTER_AUTH_URL/);
  });

  it("rejects a loopback Better Auth hostname that differs from the server bind", () => {
    // Defect caught: opening the bound address could otherwise fail Better Auth's origin check.
    expect(() =>
      parseServerEnv({
        APP_ENV: "production",
        DATABASE_URL: "postgresql://factory_app:password@127.0.0.1:5432/factory_erp",
        BETTER_AUTH_SECRET: "a".repeat(32),
        BETTER_AUTH_URL: "http://localhost:3100",
        HOSTNAME: "127.0.0.1",
        PORT: "3100",
      }),
    ).toThrowError(/BETTER_AUTH_URL/);
  });

  it("parses the exact Tailscale HTTPS origin alongside the local auth base URL", () => {
    // Defect caught: remote sign-in could be blocked when the exact tailnet origin is configured.
    expect(
      parseServerEnv({
        APP_ENV: "production",
        DATABASE_URL: "postgresql://factory_app:password@127.0.0.1:5432/factory_erp",
        BETTER_AUTH_SECRET: "a".repeat(32),
        BETTER_AUTH_URL: "http://127.0.0.1:3100",
        BETTER_AUTH_TRUSTED_ORIGINS: "https://factory-server.example-tailnet.ts.net",
        HOSTNAME: "127.0.0.1",
        PORT: "3100",
      }),
    ).toMatchObject({
      BETTER_AUTH_URL: "http://127.0.0.1:3100",
      BETTER_AUTH_TRUSTED_ORIGINS: ["https://factory-server.example-tailnet.ts.net"],
    });
  });

  it.each([
    ["wildcard", "https://*.example-tailnet.ts.net"],
    ["malformed", "not-a-url"],
    ["public HTTP", "http://erp.example.com"],
    ["non-tailnet HTTPS", "https://erp.example.com"],
    ["malformed tailnet HTTPS", "https://factory..example-tailnet.ts.net"],
  ])("rejects a %s trusted origin", (_description, trustedOrigin) => {
    // Defect caught: a broad or public origin could bypass the intended exact private-origin boundary.
    expect(() =>
      parseServerEnv({
        APP_ENV: "production",
        DATABASE_URL: "postgresql://factory_app:password@127.0.0.1:5432/factory_erp",
        BETTER_AUTH_SECRET: "a".repeat(32),
        BETTER_AUTH_URL: "http://127.0.0.1:3100",
        BETTER_AUTH_TRUSTED_ORIGINS: trustedOrigin,
        HOSTNAME: "127.0.0.1",
        PORT: "3100",
      }),
    ).toThrowError(/BETTER_AUTH_TRUSTED_ORIGINS/);
  });
});
