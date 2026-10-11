import Decimal from "decimal.js";

/**
 * BUG-40: a reprocess batch reworks the bottles taken from REPROCESS custody, so its default plan
 * is those pieces (as cartons + loose) and a batch size scaled from the recipe's standard batch by
 * pieces / expected pieces per standard batch -- not a full standard batch and 1 bottle.
 */
export function reprocessPlanDefaults(
  sourcePieces: string,
  recipe:
    | {
        standardBatchQuantity: string;
        expectedPiecesPerStandardBatch: string | null;
        piecesPerCarton: number;
      }
    | undefined,
) {
  let pieces: Decimal;
  try {
    pieces = new Decimal(sourcePieces || "0").floor();
  } catch {
    pieces = new Decimal(0);
  }
  if (!recipe || pieces.lte(0))
    return { batchQuantity: recipe?.standardBatchQuantity ?? "", cartons: "0", loosePieces: "" };
  const perStandardBatch = recipe.expectedPiecesPerStandardBatch
    ? new Decimal(recipe.expectedPiecesPerStandardBatch)
    : null;
  const batchQuantity =
    perStandardBatch && perStandardBatch.gt(0)
      ? new Decimal(recipe.standardBatchQuantity)
          .mul(pieces)
          .div(perStandardBatch)
          .toDecimalPlaces(3, Decimal.ROUND_HALF_UP)
          .toFixed()
      : recipe.standardBatchQuantity;
  const perCarton = recipe.piecesPerCarton > 0 ? recipe.piecesPerCarton : 0;
  return {
    batchQuantity,
    cartons: perCarton ? pieces.div(perCarton).floor().toFixed() : "0",
    loosePieces: perCarton ? pieces.mod(perCarton).toFixed() : pieces.toFixed(),
  };
}
