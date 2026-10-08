import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import { acceptedGrniShare, outstandingGrni, rejectedReturnGrniClearance } from "./grni";

describe("GRNI per goods-receipt line (BUG-35)", () => {
  // GRN-6: 5 kg tomato paste received at 610/kg, 1 kg rejected at QC.
  const grn6 = { value: "3050", receivedQuantity: "5", acceptedQuantity: "4" };

  it("clears returned rejected stock at its receipt cost, not the moving average", () => {
    expect(acceptedGrniShare(grn6).toFixed(2)).toBe("2440.00");
    expect(rejectedReturnGrniClearance(grn6, "0", "1").toFixed(2)).toBe("610.00");
    expect(outstandingGrni(grn6, "1").toFixed(2)).toBe("0.00");
  });

  it("keeps the full receipt value outstanding until QC decides the line", () => {
    expect(outstandingGrni({ ...grn6, acceptedQuantity: null }, "0").toFixed(2)).toBe("3050.00");
  });

  it("leaves rejected stock that has not gone back in GRNI", () => {
    expect(outstandingGrni(grn6, "0").toFixed(2)).toBe("610.00");
  });

  it("clears exactly to zero however rounding splits the rejected quantity", () => {
    const line = { value: "1000", receivedQuantity: "3", acceptedQuantity: "1" };
    const accepted = acceptedGrniShare(line);
    const first = rejectedReturnGrniClearance(line, "0", "1");
    const second = rejectedReturnGrniClearance(line, "1", "1");
    expect(accepted.toFixed(2)).toBe("333.33");
    expect(first.toFixed(2)).toBe("333.33");
    expect(second.toFixed(2)).toBe("333.34");
    expect(new Decimal(line.value).sub(accepted).sub(first).sub(second).toFixed(2)).toBe("0.00");
    expect(outstandingGrni(line, "2").toFixed(2)).toBe("0.00");
    expect(outstandingGrni(line, "1").toFixed(2)).toBe("333.34");
  });
});
