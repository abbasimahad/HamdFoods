import { beforeEach, describe, expect, it, vi } from "vitest";

const { getSystemHealth } = vi.hoisted(() => ({ getSystemHealth: vi.fn() }));

vi.mock("@/modules/system/application/get-system-health", () => ({ getSystemHealth }));
vi.mock("@/server/db/probe-database", () => ({ probeDatabase: vi.fn() }));

import { GET } from "./route";

describe("GET /api/health", () => {
  beforeEach(() => getSystemHealth.mockReset());

  it("returns a minimal ready response after the database probe succeeds", async () => {
    // Defect caught: a health endpoint could disclose internal state or claim readiness without its dependency.
    getSystemHealth.mockResolvedValue({
      application: "operational",
      configuration: "valid",
      database: "connected",
    });

    const response = await GET();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({ status: "ok" });
  });

  it("returns unavailable without exposing health implementation detail", async () => {
    // Defect caught: database failure state could leak from an unauthenticated operational endpoint.
    getSystemHealth.mockResolvedValue({
      application: "operational",
      configuration: "valid",
      database: "unavailable",
    });

    const response = await GET();

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ status: "unavailable" });
  });
});
