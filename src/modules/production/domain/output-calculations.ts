import Decimal from "decimal.js";
import {
  calculateCartonsAndLooseContent,
  type FinishedGoodContentProfile,
} from "@/modules/quantity/domain/cartons";
import type { UnitDimension } from "@/modules/master-data/domain/master-data";

export function normalizeGoodOutput(
  cartons: string,
  loosePieces: string,
  profile: FinishedGoodContentProfile,
) {
  const result = calculateCartonsAndLooseContent(profile, cartons, loosePieces);
  if (new Decimal(result.breakdown.totalPieces).lte(0))
    throw new Error("Good output must contain at least one finished piece.");
  return {
    cartons: result.breakdown.cartons,
    loosePieces: result.breakdown.loosePieces,
    totalPieces: result.breakdown.totalPieces,
    contentQuantity: result.content.amount,
    contentDimension: result.content.unit.dimension,
  };
}

export function calculateOutputReconciliation(input: {
  basisDimension: UnitDimension;
  inputComponents: readonly { dimension: UnitDimension; quantity: string }[];
  goodOutput: string;
  reprocessOutput: string;
  rejectedOutput: string;
  processLoss: string;
  expectedYieldPercent: string | null;
}) {
  const components = input.inputComponents.filter((part) => new Decimal(part.quantity).gt(0));
  const compatible =
    components.length > 0 && components.every((part) => part.dimension === input.basisDimension);
  const good = nonnegative(input.goodOutput);
  const reprocess = nonnegative(input.reprocessOutput);
  const rejected = nonnegative(input.rejectedOutput);
  const loss = nonnegative(input.processLoss);
  const totalAccounted = good.add(reprocess).add(rejected).add(loss);
  if (!compatible)
    return {
      compatible: false as const,
      actualInput: null,
      totalAccountedOutput: totalAccounted.toFixed(),
      unreconciledDifference: null,
      goodYieldPercent: null,
      recoverableYieldPercent: null,
      processLossPercent: null,
      expectedYieldDifferencePoints: null,
    };
  const actualInput = components.reduce(
    (sum, part) => sum.add(nonnegative(part.quantity)),
    new Decimal(0),
  );
  if (actualInput.lte(0))
    return {
      compatible: false as const,
      actualInput: null,
      totalAccountedOutput: totalAccounted.toFixed(),
      unreconciledDifference: null,
      goodYieldPercent: null,
      recoverableYieldPercent: null,
      processLossPercent: null,
      expectedYieldDifferencePoints: null,
    };
  const goodYield = good.div(actualInput).mul(100);
  return {
    compatible: true as const,
    actualInput: actualInput.toFixed(),
    totalAccountedOutput: totalAccounted.toFixed(),
    unreconciledDifference: actualInput.sub(totalAccounted).toFixed(),
    goodYieldPercent: percent(goodYield),
    recoverableYieldPercent: percent(good.add(reprocess).div(actualInput).mul(100)),
    processLossPercent: percent(loss.div(actualInput).mul(100)),
    expectedYieldDifferencePoints:
      input.expectedYieldPercent === null
        ? null
        : percent(goodYield.sub(input.expectedYieldPercent)),
  };
}

export function calculateFinalPackagingStandard(
  usageBasis: "PER_PIECE" | "PER_CARTON",
  bomCanonicalQuantity: string,
  actualPieces: string,
  actualCartons: string,
) {
  const basis = usageBasis === "PER_PIECE" ? actualPieces : actualCartons;
  return nonnegative(bomCanonicalQuantity).mul(nonnegative(basis)).toFixed();
}

function nonnegative(value: string) {
  const parsed = new Decimal(value);
  if (!parsed.isFinite() || parsed.lt(0) || parsed.decimalPlaces() > 6)
    throw new Error("Production output quantity is invalid.");
  return parsed;
}
function percent(value: Decimal) {
  return value.toDecimalPlaces(6, Decimal.ROUND_HALF_UP).toFixed();
}
