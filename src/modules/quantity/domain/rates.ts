import Decimal from "decimal.js";

import { parsePositiveInteger } from "./cartons";
import { decimalToString, parseNonNegativeDecimal, QuantityDomainError } from "./quantity";

export function pieceRateFromCartonRate(
  cartonRate: string,
  piecesPerCarton: number | string | bigint,
  decimalPlaces = 6,
) {
  validateDecimalPlaces(decimalPlaces);
  const rate = parseNonNegativeDecimal(cartonRate, "Carton rate");
  const packSize = parsePositiveInteger(piecesPerCarton, "Pieces per carton");
  return decimalToString(
    rate.div(packSize.toString()).toDecimalPlaces(decimalPlaces, Decimal.ROUND_HALF_UP),
  );
}

export function cartonRateFromPieceRate(
  pieceRate: string,
  piecesPerCarton: number | string | bigint,
) {
  const rate = parseNonNegativeDecimal(pieceRate, "Piece rate");
  const packSize = parsePositiveInteger(piecesPerCarton, "Pieces per carton");
  return decimalToString(rate.mul(packSize.toString()));
}

function validateDecimalPlaces(decimalPlaces: number) {
  if (!Number.isInteger(decimalPlaces) || decimalPlaces < 0 || decimalPlaces > 18) {
    throw new QuantityDomainError(
      "invalid-amount",
      "Rate decimal places must be an integer between 0 and 18.",
    );
  }
}
