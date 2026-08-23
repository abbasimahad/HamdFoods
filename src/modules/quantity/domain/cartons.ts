import Decimal from "decimal.js";

import type { UnitDimension } from "@/modules/master-data/domain/master-data";

import {
  boundedDecimalToString,
  formatQuantity,
  parseNonNegativeDecimal,
  QuantityDomainError,
  type ExactQuantity,
  type QuantityUnit,
} from "./quantity";

export type CartonBreakdown = {
  cartons: string;
  loosePieces: string;
  totalPieces: string;
};

export type FinishedGoodContentProfile = {
  netContentQuantity: string;
  netContentUnit: QuantityUnit;
  piecesPerCarton: number | string | bigint;
  netContentUnitDimension: UnitDimension;
};

export function normalizeCartonQuantity(
  cartons: number | string | bigint,
  loosePieces: number | string | bigint,
  piecesPerCarton: number | string | bigint,
): CartonBreakdown {
  const cartonCount = parseNonNegativeInteger(cartons, "Cartons");
  const looseCount = parseNonNegativeInteger(loosePieces, "Loose pieces");
  const packSize = parsePositiveInteger(piecesPerCarton, "Pieces per carton");
  return breakdownFromBigInts(cartonCount * packSize + looseCount, packSize);
}

export function piecesToCartons(
  totalPieces: number | string | bigint,
  piecesPerCarton: number | string | bigint,
): CartonBreakdown {
  const total = parseNonNegativeInteger(totalPieces, "Total pieces");
  const packSize = parsePositiveInteger(piecesPerCarton, "Pieces per carton");
  return breakdownFromBigInts(total, packSize);
}

function breakdownFromBigInts(total: bigint, packSize: bigint): CartonBreakdown {
  return {
    cartons: (total / packSize).toString(),
    loosePieces: (total % packSize).toString(),
    totalPieces: total.toString(),
  };
}

export function sealedCartonsRequired(
  requiredPieces: number | string | bigint,
  piecesPerCarton: number | string | bigint,
): string {
  const required = parseNonNegativeInteger(requiredPieces, "Required pieces");
  const packSize = parsePositiveInteger(piecesPerCarton, "Pieces per carton");
  return ((required + packSize - 1n) / packSize).toString();
}

export function calculateFinishedGoodContent(
  profile: FinishedGoodContentProfile,
  totalPieces: number | string | bigint,
): ExactQuantity {
  validateContentProfile(profile);
  const pieces = parseNonNegativeInteger(totalPieces, "Total pieces", 60);
  const content = parseNonNegativeDecimal(profile.netContentQuantity, "Net content").mul(
    pieces.toString(),
  );
  return {
    amount: boundedDecimalToString(content, "Calculated finished-good content"),
    unit: profile.netContentUnit,
  };
}

export function calculateCartonContent(profile: FinishedGoodContentProfile): ExactQuantity {
  return calculateFinishedGoodContent(profile, profile.piecesPerCarton);
}

export function calculateCartonsAndLooseContent(
  profile: FinishedGoodContentProfile,
  cartons: number | string | bigint,
  loosePieces: number | string | bigint,
): { breakdown: CartonBreakdown; content: ExactQuantity } {
  const breakdown = normalizeCartonQuantity(cartons, loosePieces, profile.piecesPerCarton);
  return {
    breakdown,
    content: calculateFinishedGoodContent(profile, BigInt(breakdown.totalPieces)),
  };
}

export function formatCartonBreakdown(breakdown: CartonBreakdown) {
  return `${breakdown.cartons} cartons + ${breakdown.loosePieces} loose`;
}

export function formatFinishedGoodContent(
  content: ExactQuantity,
  availableUnits: readonly QuantityUnit[],
) {
  return formatQuantity(content, availableUnits);
}

export function parsePositiveInteger(value: number | string | bigint, label: string): bigint {
  const parsed = parseNonNegativeInteger(value, label);
  if (parsed === 0n) {
    throw new QuantityDomainError("invalid-amount", `${label} must be greater than zero.`);
  }
  return parsed;
}

function parseNonNegativeInteger(
  value: number | string | bigint,
  label: string,
  maxDigits = 30,
): bigint {
  if (typeof value === "bigint") {
    if (value >= 0n && value.toString().length <= maxDigits) return value;
  } else if (typeof value === "number") {
    if (Number.isSafeInteger(value) && value >= 0) return BigInt(value);
  } else {
    const normalized = value.trim();
    if (/^(?:0|[1-9]\d*)$/.test(normalized) && normalized.length <= maxDigits) {
      return BigInt(normalized);
    }
  }
  throw new QuantityDomainError(
    "invalid-amount",
    `${label} must be a non-negative integer of at most ${maxDigits} digits.`,
  );
}

function validateContentProfile(profile: FinishedGoodContentProfile) {
  parsePositiveInteger(profile.piecesPerCarton, "Pieces per carton");
  if (!profile.netContentUnit.active) {
    throw new QuantityDomainError("inactive-unit", `${profile.netContentUnit.code} is inactive.`);
  }
  if (
    !["MASS", "VOLUME"].includes(profile.netContentUnitDimension) ||
    profile.netContentUnit.dimension !== profile.netContentUnitDimension
  ) {
    throw new QuantityDomainError(
      "incompatible-dimension",
      "Finished-good net content must use a matching mass or volume unit.",
    );
  }
  parseNonNegativeDecimal(profile.netContentQuantity, "Net content");
  if (new Decimal(profile.netContentQuantity).lte(0)) {
    throw new QuantityDomainError("invalid-amount", "Net content must be greater than zero.");
  }
}
