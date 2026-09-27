import { describe, expect, it } from "vitest";

import { factoryBusinessDate } from "./factory-local-time";

describe("factoryBusinessDate", () => {
  it("dates an early-morning PKT posting on the local day, not the UTC day (TZ-1)", () => {
    // 03:23 PKT on 27 Sep is 22:23 UTC on 26 Sep.
    expect(factoryBusinessDate(new Date("2026-09-26T22:23:00.000Z")).toISOString()).toBe(
      "2026-09-27T00:00:00.000Z",
    );
  });

  it("leaves a date-only value on the same day", () => {
    expect(factoryBusinessDate(new Date("2026-09-30T00:00:00.000Z")).toISOString()).toBe(
      "2026-09-30T00:00:00.000Z",
    );
  });

  it("keeps a late-afternoon posting on the same local day", () => {
    expect(factoryBusinessDate(new Date("2026-09-27T18:59:59.000Z")).toISOString()).toBe(
      "2026-09-27T00:00:00.000Z",
    );
  });
});
