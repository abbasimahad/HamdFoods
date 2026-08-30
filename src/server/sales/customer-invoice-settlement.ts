import Decimal from "decimal.js";

export type InvoiceSettlementSource = {
  grandTotal: { toString(): string };
  paymentAllocations: readonly { allocatedAmount: { toString(): string } }[];
  salesReturns: readonly {
    ledgerEntry: { signedAmount: { toString(): string } } | null;
  }[];
};

export function customerInvoiceSettlement(invoice: InvoiceSettlementSource) {
  const effectivePayments = total(
    invoice.paymentAllocations.map((allocation) => allocation.allocatedAmount),
  );
  const completedReturnCredits = total(
    invoice.salesReturns.map((salesReturn) =>
      salesReturn.ledgerEntry?.signedAmount
        ? new Decimal(salesReturn.ledgerEntry.signedAmount.toString()).negated()
        : new Decimal(0),
    ),
  );
  const rawOutstanding = new Decimal(invoice.grandTotal.toString())
    .sub(effectivePayments)
    .sub(completedReturnCredits);
  return {
    effectivePayments,
    completedReturnCredits,
    rawOutstanding,
    presentationOutstanding: Decimal.max(0, rawOutstanding),
  };
}

function total(values: readonly { toString(): string }[]) {
  return values.reduce<Decimal>((sum, value) => sum.add(value.toString()), new Decimal(0));
}
