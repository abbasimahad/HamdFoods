import { describe, expect, it } from "vitest";

import { normalizeCartonQuantity, piecesToCartons } from "./cartons";
import { convertQuantity, QuantityDomainError, type QuantityUnit } from "./quantity";
import { pieceRateFromCartonRate } from "./rates";

const units = {
  kg: unit("KG", "kg", "MASS"),
  g: unit("G", "g", "MASS"),
  litre: unit("L", "L", "VOLUME"),
  ml: unit("ML", "ml", "VOLUME"),
  pieces: unit("PCS", "pcs", "COUNT"),
};

describe("exact quantity conversion", () => {
  it.each([
    ["1", units.kg, units.g, "1000"],
    ["2.5", units.kg, units.g, "2500"],
    ["1", units.litre, units.ml, "1000"],
    ["2.75", units.litre, units.ml, "2750"],
  ])("converts %s %s exactly", (amount, source, target, expected) => {
    expect(convertQuantity({ amount, unit: source }, target).amount).toBe(expected);
  });

  it.each([
    [units.kg, units.litre],
    [units.kg, units.pieces],
    [units.litre, units.pieces],
  ])("rejects incompatible dimensions", (source, target) => {
    try {
      convertQuantity({ amount: "1", unit: source }, target);
      expect.fail("Expected an incompatible-dimension error.");
    } catch (error) {
      expect(error).toBeInstanceOf(QuantityDomainError);
      expect(error).toMatchObject({ reason: "incompatible-dimension" });
    }
  });
});

describe("carton normalization", () => {
  it("normalizes cartons and loose pieces into canonical pieces", () => {
    expect(normalizeCartonQuantity(10, 7, 24)).toEqual({
      cartons: "10",
      loosePieces: "7",
      totalPieces: "247",
    });
    expect(normalizeCartonQuantity(2, 30, 24)).toEqual({
      cartons: "3",
      loosePieces: "6",
      totalPieces: "78",
    });
  });

  it.each([
    [0, { cartons: "0", loosePieces: "0", totalPieces: "0" }],
    [24, { cartons: "1", loosePieces: "0", totalPieces: "24" }],
    [247, { cartons: "10", loosePieces: "7", totalPieces: "247" }],
  ])("reverses %s pieces", (pieces, expected) => {
    expect(piecesToCartons(pieces, 24)).toEqual(expected);
  });

  it.each([
    () => normalizeCartonQuantity(1, 0, 0),
    () => normalizeCartonQuantity(-1, 0, 24),
    () => piecesToCartons(-1, 24),
  ])("rejects invalid carton inputs", (operation) => {
    expect(operation).toThrowError(QuantityDomainError);
  });

  it("derives the exact piece rate", () => {
    expect(pieceRateFromCartonRate("4080", 24)).toBe("170");
  });
});

function unit(code: string, symbol: string, dimension: QuantityUnit["dimension"]): QuantityUnit {
  return { code, symbol, dimension, active: true };
}
