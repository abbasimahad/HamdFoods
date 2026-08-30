import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";

import { calculateSalesOrderLine } from "./sales-orders";

describe("sales pricing", () => {
  it("applies discounts sequentially with exact decimal arithmetic", () => {
    const line = calculateSalesOrderLine({
      cartons: "1",
      loosePieces: "0",
      piecesPerCarton: 1,
      cartonRate: "19740",
      discount1Percent: "12",
      discount2Percent: "3",
      taxPercent: "0",
    });

    expect(line.grossAmount).toBe("19740");
    expect(line.discountAmount).toBe("2889.936");
    expect(line.netAmount).toBe("16850.064");
    expect(new Decimal(line.netAmount).eq(new Decimal("19740").mul("0.85"))).toBe(false);
  });

  it("normalizes loose pieces before pricing", () => {
    expect(
      calculateSalesOrderLine({
        cartons: "2",
        loosePieces: "30",
        piecesPerCarton: 24,
        cartonRate: "4080",
        discount1Percent: "0",
        discount2Percent: "0",
        taxPercent: "0",
      }),
    ).toMatchObject({
      cartons: "3",
      loosePieces: "6",
      totalPieces: "78",
      pieceRate: "170",
      grossAmount: "13260",
    });
  });
});
