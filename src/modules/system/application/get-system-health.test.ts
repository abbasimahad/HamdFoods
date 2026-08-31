import { describe, expect, it } from "vitest";

import { getSystemHealth } from "./get-system-health";

describe("getSystemHealth", () => {
  it("reports a connected database when the server probe resolves", async () => {
    // Defect caught: a ready dependency must not make the production readiness endpoint unavailable.
    await expect(getSystemHealth(async () => undefined)).resolves.toEqual({
      application: "operational",
      configuration: "valid",
      database: "connected",
    });
  });

  it("reports the database as unavailable when the database probe rejects", async () => {
    // Defect caught: a failed dependency must not be presented as healthy.
    const health = await getSystemHealth(async () => {
      throw new Error("connection refused");
    });

    expect(health).toEqual({
      application: "operational",
      configuration: "valid",
      database: "unavailable",
    });
  });
});
