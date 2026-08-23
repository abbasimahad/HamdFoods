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
});
