import { describe, expect, it } from "vitest";

import { formatFactoryDate, formatFactoryDateTime } from "./format-datetime";

describe("factory date formatting (BUG-32)", () => {
  it("formats a date-only value as DD/MM/YYYY without shifting the day", () => {
    expect(formatFactoryDate(new Date("2027-01-15T00:00:00.000Z"))).toBe("15/01/2027");
  });

  it("shows a timestamp on the factory-local calendar day", () => {
    // 02:21 PKT on 26 Sep is 21:21 UTC on 25 Sep.
    expect(formatFactoryDate(new Date("2026-09-25T21:21:00.000Z"))).toBe("26/09/2026");
    expect(formatFactoryDateTime(new Date("2026-09-25T21:21:00.000Z"))).toBe("26/09/2026 02:21");
  });

  it("shows a posted-at timestamp in local time, not UTC", () => {
    expect(formatFactoryDateTime(new Date("2026-09-27T17:53:00.000Z"))).toBe("27/09/2026 22:53");
  });

  it("accepts serialized strings and passes through missing values", () => {
    expect(formatFactoryDate("2026-10-29T00:00:00.000Z")).toBe("29/10/2026");
    expect(formatFactoryDate(null)).toBeUndefined();
    expect(formatFactoryDateTime(undefined)).toBeUndefined();
  });
});
