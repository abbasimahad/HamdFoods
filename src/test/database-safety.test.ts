import { describe, expect, it } from "vitest";

import { requireSafeTestDatabaseUrl, TestDatabaseSafetyError } from "./database-safety";

describe("integration database safety", () => {
  it("accepts an explicit dedicated test database", () => {
    expect(
      requireSafeTestDatabaseUrl("postgresql://user:pass@localhost:5432/factory_erp_test"),
    ).toContain("factory_erp_test");
  });

  it("requires an explicit test database URL", () => {
    expect(() => requireSafeTestDatabaseUrl(undefined)).toThrowError(TestDatabaseSafetyError);
  });

  it("rejects the normal development database", () => {
    const development = "postgresql://user:pass@localhost:5432/factory_erp";
    expect(() => requireSafeTestDatabaseUrl(development, development)).toThrow(/must not equal/i);
    expect(() => requireSafeTestDatabaseUrl(development)).toThrow(/test-only/i);
  });

  it("rejects non-PostgreSQL URLs", () => {
    expect(() => requireSafeTestDatabaseUrl("mysql://localhost/factory_test")).toThrow(
      /PostgreSQL/i,
    );
  });
});
