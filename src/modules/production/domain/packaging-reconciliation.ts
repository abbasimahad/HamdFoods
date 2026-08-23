import Decimal from "decimal.js";

export function reconcilePackaging(input: {
  plannedStandard: string;
  issued: string;
  returned: string;
  goodConsumed: string;
  damaged: string;
}) {
  const planned = nonnegative(input.plannedStandard, "Planned standard");
  const issued = nonnegative(input.issued, "Issued quantity");
  const returned = nonnegative(input.returned, "Returned quantity");
  const consumed = nonnegative(input.goodConsumed, "Good consumption");
  const damaged = nonnegative(input.damaged, "Damaged quantity");
  const held = issued.sub(returned).sub(consumed).sub(damaged);
  if (held.lt(0)) throw new Error("Packaging custody cannot be negative.");
  const totalDepleted = consumed.add(damaged);
  return {
    currentlyInProduction: held.toFixed(),
    totalDepleted: totalDepleted.toFixed(),
    provisionalVarianceQuantity: totalDepleted.sub(planned).toFixed(),
    provisionalVarianceDirection: direction(totalDepleted.sub(planned)),
    goodConsumptionVarianceQuantity: consumed.sub(planned).toFixed(),
    goodConsumptionVarianceDirection: direction(consumed.sub(planned)),
  };
}

function nonnegative(value: string, label: string) {
  const parsed = new Decimal(value);
  if (!parsed.isFinite() || parsed.lt(0) || parsed.decimalPlaces() > 6)
    throw new Error(`${label} is invalid.`);
  return parsed;
}

function direction(value: Decimal) {
  return value.gt(0) ? ("OVER" as const) : value.lt(0) ? ("UNDER" as const) : ("EXACT" as const);
}
