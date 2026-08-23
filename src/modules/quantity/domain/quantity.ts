import Decimal from "decimal.js";

import type { UnitDimension } from "@/modules/master-data/domain/master-data";

Decimal.set({ precision: 128, rounding: Decimal.ROUND_HALF_UP });

export const SUPPORTED_QUANTITY_UNIT_CODES = ["KG", "G", "L", "ML", "PCS"] as const;
export type SupportedQuantityUnitCode = (typeof SUPPORTED_QUANTITY_UNIT_CODES)[number];

export type QuantityUnit = {
  code: string;
  symbol: string;
  dimension: UnitDimension;
  active: boolean;
};

export type ExactQuantity = {
  amount: string;
  unit: QuantityUnit;
};

type SupportedUnitRule = {
  dimension: UnitDimension;
  factorToCanonical: string;
  canonicalCode: "G" | "ML" | "PCS";
  preferredDisplayCode: "KG" | "L" | "PCS";
};

const SUPPORTED_UNIT_RULES: Readonly<Record<string, SupportedUnitRule>> = {
  KG: {
    dimension: "MASS",
    factorToCanonical: "1000",
    canonicalCode: "G",
    preferredDisplayCode: "KG",
  },
  G: {
    dimension: "MASS",
    factorToCanonical: "1",
    canonicalCode: "G",
    preferredDisplayCode: "KG",
  },
  L: {
    dimension: "VOLUME",
    factorToCanonical: "1000",
    canonicalCode: "ML",
    preferredDisplayCode: "L",
  },
  ML: {
    dimension: "VOLUME",
    factorToCanonical: "1",
    canonicalCode: "ML",
    preferredDisplayCode: "L",
  },
  PCS: {
    dimension: "COUNT",
    factorToCanonical: "1",
    canonicalCode: "PCS",
    preferredDisplayCode: "PCS",
  },
};

export class QuantityDomainError extends Error {
  constructor(
    readonly reason:
      | "invalid-amount"
      | "inactive-unit"
      | "unsupported-unit"
      | "incompatible-dimension"
      | "missing-canonical-unit"
      | "negative-result",
    message: string,
  ) {
    super(message);
    this.name = "QuantityDomainError";
  }
}

export function normalizeQuantity(
  quantity: ExactQuantity,
  availableUnits: readonly QuantityUnit[],
): ExactQuantity {
  const rule = unitRule(quantity.unit);
  const canonicalUnit = availableUnits.find(
    (unit) => unit.active && normalizedCode(unit.code) === rule.canonicalCode,
  );
  if (!canonicalUnit) {
    throw new QuantityDomainError(
      "missing-canonical-unit",
      `Active canonical unit ${rule.canonicalCode} is required.`,
    );
  }
  return convertQuantity(quantity, canonicalUnit);
}

export function convertQuantity(quantity: ExactQuantity, targetUnit: QuantityUnit): ExactQuantity {
  const sourceRule = unitRule(quantity.unit);
  const targetRule = unitRule(targetUnit);
  if (sourceRule.dimension !== targetRule.dimension) {
    throw new QuantityDomainError(
      "incompatible-dimension",
      `${quantity.unit.code} cannot be converted to ${targetUnit.code}.`,
    );
  }
  const amount = parseNonNegativeDecimal(quantity.amount, "Quantity", 121);
  if (sourceRule.dimension === "COUNT" && !amount.isInteger()) {
    throw new QuantityDomainError("invalid-amount", "Count quantities must be whole pieces.");
  }
  return {
    amount: boundedDecimalToString(
      amount.mul(sourceRule.factorToCanonical).div(targetRule.factorToCanonical),
      "Converted quantity",
    ),
    unit: targetUnit,
  };
}

export function compareQuantities(
  left: ExactQuantity,
  right: ExactQuantity,
  availableUnits: readonly QuantityUnit[],
) {
  const [normalizedLeft, normalizedRight] = compatibleCanonicalPair(left, right, availableUnits);
  return new Decimal(normalizedLeft.amount).cmp(normalizedRight.amount) as -1 | 0 | 1;
}

export function addQuantities(
  left: ExactQuantity,
  right: ExactQuantity,
  availableUnits: readonly QuantityUnit[],
): ExactQuantity {
  const [normalizedLeft, normalizedRight] = compatibleCanonicalPair(left, right, availableUnits);
  const result = new Decimal(normalizedLeft.amount).add(normalizedRight.amount);
  return {
    amount: boundedDecimalToString(result, "Quantity result"),
    unit: normalizedLeft.unit,
  };
}

export function subtractQuantities(
  left: ExactQuantity,
  right: ExactQuantity,
  availableUnits: readonly QuantityUnit[],
): ExactQuantity {
  const [normalizedLeft, normalizedRight] = compatibleCanonicalPair(left, right, availableUnits);
  const result = new Decimal(normalizedLeft.amount).sub(normalizedRight.amount);
  if (result.isNegative()) {
    throw new QuantityDomainError(
      "negative-result",
      "Quantity subtraction cannot produce a negative result in this phase.",
    );
  }
  return {
    amount: boundedDecimalToString(result, "Quantity result"),
    unit: normalizedLeft.unit,
  };
}

export function formatQuantity(
  quantity: ExactQuantity,
  availableUnits: readonly QuantityUnit[],
): string {
  const normalized = normalizeQuantity(quantity, availableUnits);
  const rule = unitRule(normalized.unit);
  const preferred = availableUnits.find(
    (unit) => unit.active && normalizedCode(unit.code) === rule.preferredDisplayCode,
  );
  const displayQuantity =
    preferred && new Decimal(normalized.amount).gte(1000)
      ? convertQuantity(normalized, preferred)
      : normalized;
  return `${displayQuantity.amount} ${displayQuantity.unit.symbol}`;
}

export function parseNonNegativeDecimal(value: string, label: string, maxDigits = 60): Decimal {
  const normalized = value.trim();
  if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(normalized) || normalized.length > 130) {
    throw new QuantityDomainError(
      "invalid-amount",
      `${label} must be a bounded non-negative decimal without exponent notation.`,
    );
  }
  const parsed = new Decimal(normalized);
  if (parsed.sd() > maxDigits) {
    throw new QuantityDomainError(
      "invalid-amount",
      `${label} must contain at most ${maxDigits} significant digits.`,
    );
  }
  return parsed;
}

export function decimalToString(value: Decimal): string {
  return value.isZero() ? "0" : value.toFixed();
}

export function boundedDecimalToString(value: Decimal, label: string, maxDigits = 121): string {
  const serialized = decimalToString(value);
  parseNonNegativeDecimal(serialized, label, maxDigits);
  return serialized;
}

export function isSupportedQuantityUnitCode(code: string): code is SupportedQuantityUnitCode {
  return SUPPORTED_QUANTITY_UNIT_CODES.includes(normalizedCode(code) as SupportedQuantityUnitCode);
}

export function isCanonicalPieceUnit(unit: Pick<QuantityUnit, "code" | "dimension">) {
  return normalizedCode(unit.code) === "PCS" && unit.dimension === "COUNT";
}

export function supportedQuantityUnitDimension(code: string): UnitDimension | null {
  return SUPPORTED_UNIT_RULES[normalizedCode(code)]?.dimension ?? null;
}

function compatibleCanonicalPair(
  left: ExactQuantity,
  right: ExactQuantity,
  availableUnits: readonly QuantityUnit[],
): readonly [ExactQuantity, ExactQuantity] {
  if (left.unit.dimension !== right.unit.dimension) {
    throw new QuantityDomainError(
      "incompatible-dimension",
      `${left.unit.code} and ${right.unit.code} have incompatible dimensions.`,
    );
  }
  return [normalizeQuantity(left, availableUnits), normalizeQuantity(right, availableUnits)];
}

function unitRule(unit: QuantityUnit): SupportedUnitRule {
  if (!unit.active) {
    throw new QuantityDomainError("inactive-unit", `${unit.code} is inactive.`);
  }
  const rule = SUPPORTED_UNIT_RULES[normalizedCode(unit.code)];
  if (!rule || rule.dimension !== unit.dimension) {
    throw new QuantityDomainError(
      "unsupported-unit",
      `${unit.code} is not a supported ${unit.dimension.toLowerCase()} conversion unit.`,
    );
  }
  return rule;
}

function normalizedCode(code: string) {
  return code.trim().toUpperCase();
}
