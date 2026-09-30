import { describe, expect, it } from "vitest";

import { displayAmounts, formatMoney } from "./format-money";

describe("displayAmounts (UX-9)", () => {
  it("formats exact report amounts and leaves other values alone", () => {
    const asOf = new Date("2026-09-29T00:00:00.000Z");
    expect(
      displayAmounts({
        total: "36350.000000",
        loss: "-6819.230000",
        rows: [{ code: "1000", quantity: "160", amount: "0.000000" }],
        asOf,
        count: 3,
      }),
    ).toEqual({
      total: "36,350.00",
      loss: "-6,819.23",
      rows: [{ code: "1000", quantity: "160", amount: "0.00" }],
      asOf,
      count: 3,
    });
  });

  it("rounds half-up on the exact decimal", () => {
    expect(formatMoney("122.125000", "")).toBe("122.13");
  });
});
