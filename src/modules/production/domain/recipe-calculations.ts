import Decimal from "decimal.js";
import { normalizeCartonQuantity } from "@/modules/quantity/domain/cartons";
import {
  normalizeQuantity,
  QuantityDomainError,
  type QuantityUnit,
} from "@/modules/quantity/domain/quantity";
import type {
  PackagingRequirementResult,
  PackagingUsageBasis,
  ScaleRecipeResult,
} from "../application/contracts";

type IngredientSource = {
  itemCode: string;
  itemName: string;
  normalizedQuantity: string;
  canonicalUnitCode: string;
  canonicalUnitSymbol: string;
  allowancePercent: string;
};
type PackagingSource = IngredientSource & {
  usageBasis: PackagingUsageBasis;
  canonicalUnitDimension: "MASS" | "VOLUME" | "COUNT";
};

export function scaleRecipe(
  source: {
    standardBatchNormalizedQuantity: string;
    standardBatchDimension: "MASS" | "VOLUME" | "COUNT";
    standardBatchCanonicalCode: string;
    ingredients: readonly IngredientSource[];
  },
  target: { quantity: string; unit: QuantityUnit },
  availableUnits: readonly QuantityUnit[],
): ScaleRecipeResult {
  const normalized = normalizeQuantity(
    { amount: target.quantity, unit: target.unit },
    availableUnits,
  );
  if (normalized.unit.dimension !== source.standardBatchDimension)
    throw new QuantityDomainError(
      "incompatible-dimension",
      "Target batch unit must match the recipe standard-batch dimension.",
    );
  const standard = positive(source.standardBatchNormalizedQuantity, "Standard batch quantity");
  const targetAmount = positive(normalized.amount, "Target batch quantity");
  const factor = targetAmount.div(standard);
  return {
    targetEnteredQuantity: target.quantity,
    targetEnteredUnitCode: target.unit.code,
    targetNormalizedQuantity: targetAmount.toFixed(),
    targetCanonicalUnitCode: source.standardBatchCanonicalCode,
    scaleFactor: factor.toFixed(),
    ingredients: source.ingredients.map((line) => {
      const scaled = positive(line.normalizedQuantity, "Ingredient quantity").mul(factor);
      return {
        itemCode: line.itemCode,
        itemName: line.itemName,
        standardNormalizedQuantity: line.normalizedQuantity,
        scaledNormalizedQuantity: scaled.toFixed(),
        plannedIssueNormalizedQuantity: applyAllowance(scaled, line.allowancePercent, false),
        canonicalUnitCode: line.canonicalUnitCode,
        canonicalUnitSymbol: line.canonicalUnitSymbol,
        allowancePercent: line.allowancePercent,
      };
    }),
  };
}

export function calculatePackagingRequirements(
  source: { piecesPerCarton: number; lines: readonly PackagingSource[] },
  cartons: string,
  loosePieces: string,
): PackagingRequirementResult {
  const breakdown = normalizeCartonQuantity(cartons, loosePieces, source.piecesPerCarton);
  return {
    ...breakdown,
    lines: source.lines.map((line) => {
      const basis = line.usageBasis === "PER_PIECE" ? breakdown.totalPieces : breakdown.cartons;
      const required = positive(line.normalizedQuantity, "Packaging quantity").mul(basis);
      return {
        itemCode: line.itemCode,
        itemName: line.itemName,
        usageBasis: line.usageBasis,
        basisQuantity: basis,
        standardRequiredQuantity: required.toFixed(),
        recommendedIssueQuantity: applyAllowance(
          required,
          line.allowancePercent,
          line.canonicalUnitDimension === "COUNT",
        ),
        canonicalUnitCode: line.canonicalUnitCode,
        canonicalUnitSymbol: line.canonicalUnitSymbol,
        allowancePercent: line.allowancePercent,
      };
    }),
  };
}

export function calculateExpectedYield(source: {
  standardBatchNormalizedQuantity: string;
  standardBatchDimension: string;
  expectedOutputNormalizedQuantity: string | null;
  expectedOutputDimension: string | null;
}) {
  if (
    !source.expectedOutputNormalizedQuantity ||
    source.expectedOutputDimension !== source.standardBatchDimension
  )
    return null;
  return positive(source.expectedOutputNormalizedQuantity, "Expected output")
    .div(positive(source.standardBatchNormalizedQuantity, "Standard batch"))
    .mul(100)
    .toDecimalPlaces(6, Decimal.ROUND_HALF_UP)
    .toFixed();
}

function applyAllowance(quantity: Decimal, percentage: string, roundCount: boolean) {
  const allowance = nonnegative(percentage, "Allowance percentage");
  const result = quantity.mul(new Decimal(1).add(allowance.div(100)));
  return (roundCount ? result.ceil() : result).toFixed();
}
function positive(value: string, label: string) {
  const result = nonnegative(value, label);
  if (result.lte(0))
    throw new QuantityDomainError("invalid-amount", `${label} must be greater than zero.`);
  return result;
}
function nonnegative(value: string, label: string) {
  let result: Decimal;
  try {
    result = new Decimal(value);
  } catch {
    throw new QuantityDomainError("invalid-amount", `${label} is invalid.`);
  }
  if (
    !result.isFinite() ||
    result.lt(0) ||
    result.decimalPlaces() > 6 ||
    result.gt("999999999999999999.999999")
  )
    throw new QuantityDomainError("invalid-amount", `${label} is outside the supported range.`);
  return result;
}
