import Decimal from "decimal.js";

export function reconcileMaterial(input: {
  planned: string;
  issued: string;
  returned: string;
  consumed: string;
}) {
  const planned = exactNonnegative(input.planned, "Planned quantity");
  const issued = exactNonnegative(input.issued, "Issued quantity");
  const returned = exactNonnegative(input.returned, "Returned quantity");
  const consumed = exactNonnegative(input.consumed, "Consumed quantity");
  const held = issued.sub(returned).sub(consumed);
  if (held.lt(0)) throw new Error("Material custody cannot be negative.");
  const variance = consumed.sub(planned);
  return {
    currentlyInProduction: held.toFixed(),
    varianceQuantity: variance.toFixed(),
    varianceDirection: variance.gt(0)
      ? ("OVER" as const)
      : variance.lt(0)
        ? ("UNDER" as const)
        : ("EXACT" as const),
  };
}

function exactNonnegative(value: string, label: string) {
  const parsed = new Decimal(value);
  if (!parsed.isFinite() || parsed.lt(0) || parsed.decimalPlaces() > 6)
    throw new Error(`${label} is invalid.`);
  return parsed;
}
