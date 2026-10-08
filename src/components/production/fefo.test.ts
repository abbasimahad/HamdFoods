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

  it("falls back to the oldest receipt when lots carry no dates (raw material, packaging)", () => {
    const received = (id: string, at: string, grn: string) => ({
      id,
      expiryDate: null,
      manufacturingDate: null,
      receivedAt: new Date(at),
      goodsReceiptNumber: grn,
    });
    const sorted = sortFefo([
      received("SG-03", "2026-10-05T09:00:00Z", "GRN-2026-000009"),
      received("SG-01", "2026-09-26T09:00:00Z", "GRN-2026-000002"),
      received("SG-02", "2026-09-26T09:00:00Z", "GRN-2026-000004"),
    ]);
    expect(sorted.map((row) => row.id)).toEqual(["SG-01", "SG-02", "SG-03"]);
  });
});
