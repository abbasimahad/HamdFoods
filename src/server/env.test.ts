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

  it("rejects production configuration without Compose database settings", () => {
    // Defect caught: a production container could start without the values Compose needs to keep its database private.
    expect(() =>
      parseServerEnv({
        APP_ENV: "production",
        DATABASE_URL: "postgresql://factory_app:password@database:5432/factory_erp",
        BETTER_AUTH_SECRET: "a".repeat(32),
        BETTER_AUTH_URL: "http://127.0.0.1:3000",
      }),
    ).toThrowError(/POSTGRES_USER/);
  });

  it("rejects a loopback database URL in production", () => {
    // Defect caught: an application container would otherwise target itself rather than the private Compose database service.
    expect(() =>
      parseServerEnv({
        APP_ENV: "production",
        DATABASE_URL: "postgresql://factory_app:password@localhost:5432/factory_erp",
        BETTER_AUTH_SECRET: "a".repeat(32),
        BETTER_AUTH_URL: "http://127.0.0.1:3000",
        POSTGRES_USER: "factory_app",
        POSTGRES_PASSWORD: "password",
        POSTGRES_DB: "factory_erp",
      }),
    ).toThrowError(/DATABASE_URL/);
  });

  it("accepts the private Compose database URL in production", () => {
    expect(
      parseServerEnv({
        APP_ENV: "production",
        DATABASE_URL: "postgresql://factory_app:password@database:5432/factory_erp",
        BETTER_AUTH_SECRET: "a".repeat(32),
        BETTER_AUTH_URL: "http://127.0.0.1:3000",
        POSTGRES_USER: "factory_app",
        POSTGRES_PASSWORD: "password",
        POSTGRES_DB: "factory_erp",
      }),
    ).toMatchObject({ APP_ENV: "production" });
  });
});
