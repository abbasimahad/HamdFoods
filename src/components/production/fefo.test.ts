import { describe, expect, it } from "vitest";
import { sortFefo } from "./fefo";

const lot = (id: string, expiry: string | null, made: string | null = null) => ({
  id,
  expiryDate: expiry ? new Date(expiry) : null,
  manufacturingDate: made ? new Date(made) : null,
});

describe("sortFefo (UX-10)", () => {
  it("offers the soonest-expiring lot first and undated lots last", () => {
    const sorted = sortFefo([
      lot("newest", "2027-06-01"),
      lot("undated", null),
      lot("oldest", "2026-12-01"),
      lot("same-expiry-older", "2027-06-01", "2026-01-01"),
    ]);
    expect(sorted.map((row) => row.id)).toEqual([
      "oldest",
      "same-expiry-older",
      "newest",
      "undated",
    ]);
  });
});
