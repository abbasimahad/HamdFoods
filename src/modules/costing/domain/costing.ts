import Decimal from "decimal.js";

export const VALUATION_METHOD = "MOVING_WEIGHTED_AVERAGE" as const;
export const PRODUCTION_COST_CATEGORIES = [
  "DIRECT_LABOR",
  "MACHINE",
  "UTILITIES",
  "FACTORY_OVERHEAD",
  "OTHER_DIRECT",
  "COST_CREDIT",
] as const;
export const LANDED_COST_ALLOCATION_METHODS = ["BY_LINE_VALUE", "BY_QUANTITY", "MANUAL"] as const;

export function exactCost(value: string, label: string, allowZero = false) {
  try {
    const amount = new Decimal(value);
    if (
      !amount.isFinite() ||
      (allowZero ? amount.lt(0) : amount.lte(0)) ||
      amount.decimalPlaces() > 6 ||
      amount.gt("999999999999999999999999.999999")
    )
      throw new Error();
    return amount;
  } catch {
    throw new Error(`${label} must be an exact positive monetary amount.`);
  }
}

export function exactSignedCost(value: string, label: string) {
  try {
    const amount = new Decimal(value);
    if (
      !amount.isFinite() ||
      amount.isZero() ||
      amount.decimalPlaces() > 6 ||
      amount.abs().gt("999999999999999999999999.999999")
    )
      throw new Error();
    return amount;
  } catch {
    throw new Error(`${label} must be a non-zero exact monetary amount.`);
  }
}

export function allocateByWeights(total: string, weights: readonly string[]) {
  const amount = exactCost(total, "Landed cost total");
  const parsed = weights.map((weight) => exactCost(weight, "Allocation weight"));
  const denominator = parsed.reduce((sum, weight) => sum.add(weight), new Decimal(0));
  if (denominator.lte(0)) throw new Error("Allocation weights must total more than zero.");
  let allocated = new Decimal(0);
  return parsed.map((weight, index) => {
    const value =
      index === parsed.length - 1
        ? amount.sub(allocated)
        : amount.mul(weight).div(denominator).toDecimalPlaces(6, Decimal.ROUND_HALF_UP);
    allocated = allocated.add(value);
    return value.toFixed(6);
  });
}

export function formatCost(value: string | null, digits = 2) {
  return value === null ? "Missing" : new Decimal(value).toFixed(digits);
}
export function derivedCartonCost(unitCost: string, piecesPerCarton: number) {
  return new Decimal(unitCost).mul(piecesPerCarton).toFixed(6);
}
