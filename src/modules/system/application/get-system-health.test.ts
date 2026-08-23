import { describe, expect, it } from "vitest";

import { getSystemHealth } from "./get-system-health";

describe("getSystemHealth", () => {
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
