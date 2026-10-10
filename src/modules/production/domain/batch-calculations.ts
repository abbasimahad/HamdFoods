import Decimal from "decimal.js";
import type { RecipeRecord, RecipeUnit } from "../application/contracts";
import { calculatePackagingRequirements, scaleRecipe } from "./recipe-calculations";
import { normalizeQuantity } from "@/modules/quantity/domain/quantity";

export type ProductionBatchCalculation = {
  header: {
    recipeId: string;
    recipeVersion: number;
    finishedGoodId: string;
    plannedBatchEnteredQuantity: string;
    plannedBatchUnitId: string;
    plannedBatchUnitDimension: "MASS" | "VOLUME" | "COUNT";
    plannedBatchNormalizedQuantity: string;
    plannedBatchCanonicalUnitId: string;
    plannedBatchCanonicalDimension: "MASS" | "VOLUME" | "COUNT";
    plannedExpectedOutputNormalizedQuantity: string | null;
    expectedOutputCanonicalUnitId: string | null;
    expectedOutputCanonicalDimension: "MASS" | "VOLUME" | "COUNT" | null;
    expectedYieldPercent: string | null;
    plannedCartons: number;
    plannedLoosePieces: number;
    plannedTotalPieces: string;
    plannedProductContentNormalizedQuantity: string;
    productContentCanonicalUnitId: string;
    productContentCanonicalDimension: "MASS" | "VOLUME" | "COUNT";
    expectedOutputDifferenceNormalizedQuantity: string | null;
  };
  materialRequirements: readonly {
    sequence: number;
    recipeIngredientId: string;
    itemId: string;
    standardNormalizedQuantity: string;
    plannedNormalizedQuantity: string;
    allowancePercent: string;
    recommendedIssueQuantity: string;
    canonicalUnitId: string;
    canonicalUnitDimension: "MASS" | "VOLUME" | "COUNT";
  }[];
  packagingRequirements: readonly {
    sequence: number;
    packagingBomLineId: string;
    itemId: string;
    usageBasis: "PER_PIECE" | "PER_CARTON";
    standardRequiredQuantity: string;
    allowancePercent: string;
    recommendedIssueQuantity: string;
    canonicalUnitId: string;
    canonicalUnitDimension: "MASS" | "VOLUME" | "COUNT";
  }[];
};

export const PLANNED_OUTPUT_REQUIRED_MESSAGE = "Planned output must be more than 0 pieces.";

/**
 * BUG-37: the pieces a recipe's standard batch is expected to yield (exact, unrounded). A recipe
 * whose expected output is already in pieces gives it directly; one whose expected output is a
 * content quantity (kg, L) is divided by the finished good's content per piece, both in canonical
 * units. Null when the recipe has no expected output or it cannot be compared with the content.
 */
export function expectedPiecesPerStandardBatch(
  expectedOutput: { quantity: string; unitId: string } | null,
  contentPerPiece: { quantity: string; unitId: string },
  units: readonly RecipeUnit[],
): string | null {
  if (!expectedOutput) return null;
  const outputUnit = units.find((unit) => unit.id === expectedOutput.unitId);
  if (!outputUnit) return null;
  try {
    const output = exact(
      normalizeQuantity({ amount: expectedOutput.quantity, unit: outputUnit }, units).amount,
    );
    if (output.lte(0)) return null;
    if (outputUnit.dimension === "COUNT") return output.toFixed();
    const contentUnit = units.find((unit) => unit.id === contentPerPiece.unitId);
    if (!contentUnit || contentUnit.dimension !== outputUnit.dimension) return null;
    const content = exact(
      normalizeQuantity({ amount: contentPerPiece.quantity, unit: contentUnit }, units).amount,
    );
    return content.gt(0) ? output.div(content).toFixed() : null;
  } catch {
    return null;
  }
}

/**
 * BUG-37: the default planned pieces for a batch -- the standard batch's expected pieces scaled by
 * planned batch size / standard batch size, rounded down to whole pieces. Null when unknown or
 * when the planned size is not a valid quantity of the recipe's batch dimension.
 */
export function suggestedPlannedPieces(
  piecesPerStandardBatch: string | null,
  standardBatchNormalizedQuantity: string,
  plannedBatch: { quantity: string; unitId: string },
  units: readonly RecipeUnit[],
): number | null {
  if (!piecesPerStandardBatch) return null;
  const unit = units.find((candidate) => candidate.id === plannedBatch.unitId);
  if (!unit || !/^\d+(\.\d+)?$/.test(plannedBatch.quantity.trim())) return null;
  try {
    const standard = exact(standardBatchNormalizedQuantity);
    if (standard.lte(0)) return null;
    const planned = exact(
      normalizeQuantity({ amount: plannedBatch.quantity.trim(), unit }, units).amount,
    );
    const pieces = exact(piecesPerStandardBatch).mul(planned).div(standard).floor();
    return pieces.gt(0) && pieces.lte(Number.MAX_SAFE_INTEGER) ? pieces.toNumber() : null;
  } catch {
    return null;
  }
}

export function calculateProductionBatch(
  recipe: RecipeRecord,
  target: { quantity: string; unitId: string; cartons: string; loosePieces: string },
  finishedGoodContent: { quantity: string; unitId: string },
  units: readonly RecipeUnit[],
): ProductionBatchCalculation {
  if (recipe.status !== "APPROVED") throw new Error("Select an approved active recipe version.");
  const targetUnit = units.find((unit) => unit.id === target.unitId && unit.active);
  const contentUnit = units.find((unit) => unit.id === finishedGoodContent.unitId && unit.active);
  if (!targetUnit || !contentUnit) throw new Error("Batch or product-content unit is invalid.");

  const scaled = scaleRecipe(recipe, { quantity: target.quantity, unit: targetUnit }, units);
  const packaging = calculatePackagingRequirements(
    {
      piecesPerCarton: recipe.piecesPerCarton,
      lines: recipe.packagingLines,
    },
    target.cartons,
    target.loosePieces,
  );
  const cartons = safeInteger(packaging.cartons, "Planned cartons");
  const loosePieces = safeInteger(packaging.loosePieces, "Planned loose pieces");
  // BUG-37: a batch planned at 0 pieces can never be "short of plan", which silently switches
  // off the CTRL-1 shortfall explanation and makes yield meaningless.
  if (exact(packaging.totalPieces).lte(0)) throw new Error(PLANNED_OUTPUT_REQUIRED_MESSAGE);
  const contentPerPiece = normalizeQuantity(
    { amount: finishedGoodContent.quantity, unit: contentUnit },
    units,
  );
  const contentCanonicalUnit = units.find(
    (unit) =>
      unit.code === contentPerPiece.unit.code && unit.dimension === contentPerPiece.unit.dimension,
  );
  if (!contentCanonicalUnit) throw new Error("Finished-good content configuration is invalid.");
  const productContent = exact(contentPerPiece.amount)
    .mul(exact(packaging.totalPieces))
    .toDecimalPlaces(6, Decimal.ROUND_HALF_UP);
  const factor = exact(scaled.scaleFactor);
  const expectedOutput = recipe.expectedOutputNormalizedQuantity
    ? exact(recipe.expectedOutputNormalizedQuantity)
        .mul(factor)
        .toDecimalPlaces(6, Decimal.ROUND_HALF_UP)
    : null;
  const comparable =
    expectedOutput && recipe.expectedOutputDimension === contentCanonicalUnit.dimension;
  const difference = comparable
    ? expectedOutput.sub(productContent).toDecimalPlaces(6, Decimal.ROUND_HALF_UP)
    : null;

  return {
    header: {
      recipeId: recipe.id,
      recipeVersion: recipe.version,
      finishedGoodId: recipe.finishedGoodId,
      plannedBatchEnteredQuantity: target.quantity,
      plannedBatchUnitId: targetUnit.id,
      plannedBatchUnitDimension: targetUnit.dimension,
      plannedBatchNormalizedQuantity: scaled.targetNormalizedQuantity,
      plannedBatchCanonicalUnitId: recipe.standardBatchCanonicalUnitId,
      plannedBatchCanonicalDimension: recipe.standardBatchDimension,
      plannedExpectedOutputNormalizedQuantity: expectedOutput?.toFixed() ?? null,
      expectedOutputCanonicalUnitId: expectedOutput ? recipe.expectedOutputCanonicalUnitId : null,
      expectedOutputCanonicalDimension: expectedOutput ? recipe.expectedOutputDimension : null,
      expectedYieldPercent: recipe.expectedYieldPercent,
      plannedCartons: cartons,
      plannedLoosePieces: loosePieces,
      plannedTotalPieces: packaging.totalPieces,
      plannedProductContentNormalizedQuantity: productContent.toFixed(),
      productContentCanonicalUnitId: contentCanonicalUnit.id,
      productContentCanonicalDimension: contentCanonicalUnit.dimension,
      expectedOutputDifferenceNormalizedQuantity: difference?.toFixed() ?? null,
    },
    materialRequirements: recipe.ingredients.map((line, index) => ({
      sequence: line.sequence,
      recipeIngredientId: line.id,
      itemId: line.itemId,
      standardNormalizedQuantity: line.normalizedQuantity,
      plannedNormalizedQuantity: scaled.ingredients[index]!.scaledNormalizedQuantity,
      allowancePercent: line.allowancePercent,
      recommendedIssueQuantity: scaled.ingredients[index]!.plannedIssueNormalizedQuantity,
      canonicalUnitId: line.canonicalUnitId,
      canonicalUnitDimension: line.canonicalUnitDimension,
    })),
    packagingRequirements: recipe.packagingLines.map((line, index) => ({
      sequence: line.sequence,
      packagingBomLineId: line.id,
      itemId: line.itemId,
      usageBasis: line.usageBasis,
      standardRequiredQuantity: packaging.lines[index]!.standardRequiredQuantity,
      allowancePercent: line.allowancePercent,
      recommendedIssueQuantity: packaging.lines[index]!.recommendedIssueQuantity,
      canonicalUnitId: line.canonicalUnitId,
      canonicalUnitDimension: line.canonicalUnitDimension,
    })),
  };
}

function exact(value: string) {
  const result = new Decimal(value);
  if (!result.isFinite()) throw new Error("Calculated production quantity is invalid.");
  return result;
}

function safeInteger(value: string, label: string) {
  const result = exact(value);
  if (!result.isInteger() || result.lt(0) || result.gt(2_147_483_647))
    throw new Error(`${label} is outside the supported range.`);
  return result.toNumber();
}
