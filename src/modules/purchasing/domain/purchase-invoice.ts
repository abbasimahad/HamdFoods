import Decimal from "decimal.js";

export class PurchaseInvoiceDomainError extends Error {
  constructor(
    readonly code: "QUANTITY" | "MATCH_INCOMPLETE" | "MATCH_OVERSUBSCRIBED",
    message: string,
  ) {
    super(message);
    this.name = "PurchaseInvoiceDomainError";
  }
}

/**
 * A GRN match reserves nothing while the invoice is DRAFT; this only checks
 * that a single proposed match does not exceed the caller-supplied
 * remaining-to-invoice balance for that goods receipt line (itself derived
 * from POSTED matches only). The authoritative re-check happens again,
 * transactionally, at POST.
 */
export function validateMatchQuantity(input: {
  matchedQuantity: string;
  remainingToInvoice: string;
}) {
  const matched = decimal(input.matchedQuantity);
  if (!matched || matched.lte(0))
    throw new PurchaseInvoiceDomainError("QUANTITY", "Matched quantity must be greater than zero.");
  const remaining = decimal(input.remainingToInvoice);
  if (!remaining || matched.gt(remaining))
    throw new PurchaseInvoiceDomainError(
      "MATCH_OVERSUBSCRIBED",
      "Matched quantity exceeds the goods receipt line's accepted, unbilled balance.",
    );
  return { matchedQuantity: matched.toFixed() };
}

/**
 * POST requires every invoice line's matches to sum to exactly the invoiced
 * quantity -- zero tolerance, no partial POST. Partial matching is a valid
 * DRAFT state but never a valid POSTED one.
 */
export function validateLineMatchCompleteness(input: {
  invoicedQuantity: string;
  matchedQuantityTotal: string;
}) {
  const invoiced = decimal(input.invoicedQuantity);
  if (!invoiced || invoiced.lte(0))
    throw new PurchaseInvoiceDomainError(
      "QUANTITY",
      "Invoiced quantity must be greater than zero.",
    );
  const matched = decimal(input.matchedQuantityTotal);
  if (!matched || !matched.eq(invoiced))
    throw new PurchaseInvoiceDomainError(
      "MATCH_INCOMPLETE",
      "Line is not fully matched to received quantity; matching must exactly equal the invoiced quantity to post.",
    );
}

/**
 * Authoritative POST-time check for one goods receipt line touched by this
 * invoice: every match against it, from every POSTED invoice (this one
 * included), must not exceed what QC actually accepted. Re-read
 * transactionally at POST against freshly queried aggregates -- never
 * against values cached from DRAFT editing.
 */
export function validateGrnLineNotOversubscribed(input: {
  acceptedQuantity: string;
  matchedByOtherPostedInvoices: string;
  matchedByThisInvoice: string;
}) {
  const accepted = decimal(input.acceptedQuantity);
  const other = decimal(input.matchedByOtherPostedInvoices);
  const mine = decimal(input.matchedByThisInvoice);
  if (!accepted || accepted.lt(0) || !other || other.lt(0) || !mine || mine.lt(0))
    throw new PurchaseInvoiceDomainError("QUANTITY", "Quantity inputs must be valid.");
  if (other.add(mine).gt(accepted))
    throw new PurchaseInvoiceDomainError(
      "MATCH_OVERSUBSCRIBED",
      "Matched quantity exceeds the goods receipt line's accepted, unbilled balance.",
    );
}

/**
 * The GRN-derived tax basis for one match, pro-rated from the same
 * PurchaseOrderLine net/tax ratio postGoodsReceiptAcceptanceAccounting()
 * already uses, scaled to this match's quantity and frozen unit cost
 * instead of the full accepted quantity.
 */
export function calculateGrnDerivedTax(input: {
  grnUnitCost: string;
  matchedQuantity: string;
  purchaseOrderLineNetAmount: string;
  purchaseOrderLineTaxAmount: string;
}) {
  const unitCost = decimal(input.grnUnitCost);
  const matched = decimal(input.matchedQuantity);
  const net = decimal(input.purchaseOrderLineNetAmount);
  const tax = decimal(input.purchaseOrderLineTaxAmount);
  if (!unitCost || unitCost.lt(0) || !matched || matched.lte(0) || !net || !tax || tax.lt(0))
    throw new PurchaseInvoiceDomainError("QUANTITY", "GRN-derived tax basis inputs must be valid.");
  const purchaseBase = net.sub(tax);
  const matchedBase = unitCost.mul(matched);
  const derivedTax = purchaseBase.isZero()
    ? new Decimal(0)
    : matchedBase.mul(tax).div(purchaseBase);
  return derivedTax.toDecimalPlaces(6).toFixed(6);
}

/** Signed: positive means the supplier billed more than the GRN-derived cost. */
export function calculatePriceVariance(input: {
  invoicedUnitRate: string;
  grnUnitCost: string;
  matchedQuantity: string;
}) {
  const rate = decimal(input.invoicedUnitRate);
  const cost = decimal(input.grnUnitCost);
  const quantity = decimal(input.matchedQuantity);
  if (!rate || rate.lt(0) || !cost || cost.lt(0) || !quantity || quantity.lte(0))
    throw new PurchaseInvoiceDomainError(
      "QUANTITY",
      "Price variance inputs must be valid non-negative amounts.",
    );
  return rate.sub(cost).mul(quantity).toDecimalPlaces(6).toFixed(6);
}

/** Signed: positive means the invoice attributes more tax to this match than the GRN basis. */
export function calculateMatchTaxVariance(input: {
  invoiceLineTaxAmount: string;
  invoiceLineInvoicedQuantity: string;
  matchedQuantity: string;
  grnDerivedTaxAmount: string;
}) {
  const lineTax = decimal(input.invoiceLineTaxAmount);
  const lineQuantity = decimal(input.invoiceLineInvoicedQuantity);
  const matched = decimal(input.matchedQuantity);
  const grnTax = decimal(input.grnDerivedTaxAmount);
  if (
    !lineTax ||
    lineTax.lt(0) ||
    !lineQuantity ||
    lineQuantity.lte(0) ||
    !matched ||
    matched.lte(0) ||
    !grnTax ||
    grnTax.lt(0)
  )
    throw new PurchaseInvoiceDomainError("QUANTITY", "Tax variance inputs must be valid.");
  const invoicedTaxForMatch = lineTax.mul(matched).div(lineQuantity);
  return invoicedTaxForMatch.sub(grnTax).toDecimalPlaces(6).toFixed(6);
}

function decimal(value: string) {
  try {
    const result = new Decimal(value);
    return result.isFinite() ? result : null;
  } catch {
    return null;
  }
}
