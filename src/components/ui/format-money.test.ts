import { describe, expect, it } from "vitest";

import { displayAmounts, formatMeasure, formatMoney } from "./format-money";

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

describe("formatMeasure (UX-16)", () => {
  it("shows large gram and millilitre figures in kg and L", () => {
    expect(formatMeasure("12500", "g")).toBe("12.5 kg");
    expect(formatMeasure("12500.000000", "g")).toBe("12.5 kg");
    expect(formatMeasure("1000", "ml")).toBe("1 L");
    expect(formatMeasure("-2500", "g")).toBe("-2.5 kg");
  });

  it("keeps small amounts, pieces and other units in their own unit, grouped", () => {
    expect(formatMeasure("500", "g")).toBe("500 g");
    expect(formatMeasure("0.3105", "g")).toBe("0.311 g");
    expect(formatMeasure("12000", "pcs")).toBe("12,000 pcs");
    expect(formatMeasure("2500", "kg")).toBe("2,500 kg");
    expect(formatMeasure(null, "g")).toBe("—");
  });
});
