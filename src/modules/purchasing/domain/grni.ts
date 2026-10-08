import Decimal from "decimal.js";

/**
 * Goods Received Not Invoiced (GRNI) for one goods-receipt line.
 *
 * Receiving credits GRNI with the line's receipt value. QC acceptance moves the accepted share to
 * accounts payable; the QC-rejected share stays in GRNI until that stock goes back to the
 * supplier, and the purchase return clears it at the same receipt cost (BUG-35) -- never at the
 * item's moving-average carrying cost, which would leave a residual in GRNI.
 *
 * Shares are whole paisa. The rejected shares telescope: however the rejected quantity is split
 * across returns, returning all of it clears exactly `value - acceptedShare`, so GRNI reaches 0.00.
 */
export type GrniLine = {
  /** Receipt value of the whole line (its GRN-COST valuation). */
  value: Decimal.Value;
  receivedQuantity: Decimal.Value;
  /** Null until QC decides the line. */
  acceptedQuantity: Decimal.Value | null;
};

export function acceptedGrniShare(line: GrniLine) {
  if (line.acceptedQuantity === null) return new Decimal(0);
  const received = new Decimal(line.receivedQuantity);
  if (received.lte(0)) return new Decimal(0);
  return paisa(new Decimal(line.value).mul(line.acceptedQuantity).div(received));
}

/** GRNI carried by the first `quantity` of the line's QC-rejected stock. */
function rejectedShare(line: GrniLine, quantity: Decimal) {
  const received = new Decimal(line.receivedQuantity);
  if (received.lte(0) || quantity.lte(0)) return new Decimal(0);
  const rejected = received.sub(line.acceptedQuantity ?? 0);
  if (quantity.gte(rejected)) return new Decimal(line.value).sub(acceptedGrniShare(line));
  return paisa(new Decimal(line.value).mul(quantity).div(received));
}

/** GRNI a purchase return of `quantity` rejected stock clears, after `returnedBefore` went back. */
export function rejectedReturnGrniClearance(
  line: GrniLine,
  returnedBefore: Decimal.Value,
  quantity: Decimal.Value,
) {
  const before = new Decimal(returnedBefore);
  return rejectedShare(line, before.add(quantity)).sub(rejectedShare(line, before));
}

/** GRNI still owed on the line: nothing QC-decided yet, or rejected stock not yet returned. */
export function outstandingGrni(line: GrniLine, rejectedReturned: Decimal.Value) {
  if (line.acceptedQuantity === null) return new Decimal(line.value);
  return new Decimal(line.value)
    .sub(acceptedGrniShare(line))
    .sub(rejectedShare(line, new Decimal(rejectedReturned)));
}

function paisa(value: Decimal) {
  return value.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
}
