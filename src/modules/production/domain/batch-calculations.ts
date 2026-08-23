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
