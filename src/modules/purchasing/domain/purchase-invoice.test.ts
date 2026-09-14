import { describe, expect, it } from "vitest";
import {
  PurchaseInvoiceDomainError,
  calculateGrnDerivedTax,
  calculateMatchTaxVariance,
  calculatePriceVariance,
  validateGrnLineNotOversubscribed,
  validateLineMatchCompleteness,
  validateMatchQuantity,
} from "./purchase-invoice";

describe("validateMatchQuantity", () => {
  it("accepts a match within the remaining balance", () => {
    expect(
      validateMatchQuantity({ matchedQuantity: "10", remainingToInvoice: "10" }).matchedQuantity,
    ).toBe("10");
  });
  it("rejects zero or negative quantity", () => {
    expect(() => validateMatchQuantity({ matchedQuantity: "0", remainingToInvoice: "10" })).toThrow(
      PurchaseInvoiceDomainError,
    );
  });
  it("rejects a match exceeding the remaining balance", () => {
    expect(() =>
      validateMatchQuantity({ matchedQuantity: "10.000001", remainingToInvoice: "10" }),
    ).toThrow(/exceeds/);
  });
});

describe("validateLineMatchCompleteness", () => {
  it("passes when matches exactly equal the invoiced quantity", () => {
    expect(() =>
      validateLineMatchCompleteness({ invoicedQuantity: "25", matchedQuantityTotal: "25" }),
    ).not.toThrow();
  });
  it("blocks POST when matches are short of the invoiced quantity (zero tolerance)", () => {
    expect(() =>
      validateLineMatchCompleteness({ invoicedQuantity: "25", matchedQuantityTotal: "24.999999" }),
    ).toThrow(/not fully matched/);
  });
  it("blocks POST when matches exceed the invoiced quantity", () => {
    expect(() =>
      validateLineMatchCompleteness({ invoicedQuantity: "25", matchedQuantityTotal: "25.000001" }),
    ).toThrow(PurchaseInvoiceDomainError);
  });
});

describe("validateGrnLineNotOversubscribed", () => {
  it("passes when total matched exactly equals accepted quantity", () => {
    expect(() =>
      validateGrnLineNotOversubscribed({
        acceptedQuantity: "100",
        matchedByOtherPostedInvoices: "60",
        matchedByThisInvoice: "40",
      }),
    ).not.toThrow();
  });
  it("blocks POST when combined matches would exceed accepted quantity by any amount (zero tolerance)", () => {
    expect(() =>
      validateGrnLineNotOversubscribed({
        acceptedQuantity: "100",
        matchedByOtherPostedInvoices: "60",
        matchedByThisInvoice: "40.000001",
      }),
    ).toThrow(/exceeds/);
  });
  it("blocks two concurrent invoices from together over-invoicing one GRN line", () => {
    // Invoice A already posted 70; invoice B attempts 40 more against a 100 accepted line.
    expect(() =>
      validateGrnLineNotOversubscribed({
        acceptedQuantity: "100",
        matchedByOtherPostedInvoices: "70",
        matchedByThisInvoice: "40",
      }),
    ).toThrow(PurchaseInvoiceDomainError);
  });
});

describe("calculateGrnDerivedTax", () => {
  it("prorates tax by matched value over the PO line's net base", () => {
    // unit cost 10, matched 5 => matched base 50; tax 130 on net 1000 => 13% => 6.5
    expect(
      calculateGrnDerivedTax({
        grnUnitCost: "10",
        matchedQuantity: "5",
        purchaseOrderLineNetAmount: "1130",
        purchaseOrderLineTaxAmount: "130",
      }),
    ).toBe("6.500000");
  });
  it("returns zero tax when the PO line has no net base (fully tax-only, defensive)", () => {
    expect(
      calculateGrnDerivedTax({
        grnUnitCost: "10",
        matchedQuantity: "5",
        purchaseOrderLineNetAmount: "0",
        purchaseOrderLineTaxAmount: "0",
      }),
    ).toBe("0.000000");
  });
});

describe("calculatePriceVariance", () => {
  it("is zero when the invoiced rate matches the GRN-derived cost", () => {
    expect(
      calculatePriceVariance({ invoicedUnitRate: "10", grnUnitCost: "10", matchedQuantity: "5" }),
    ).toBe("0.000000");
  });
  it("is positive when the supplier billed more than the GRN cost", () => {
    expect(
      calculatePriceVariance({ invoicedUnitRate: "12", grnUnitCost: "10", matchedQuantity: "5" }),
    ).toBe("10.000000");
  });
  it("is negative when the supplier billed less than the GRN cost", () => {
    expect(
      calculatePriceVariance({ invoicedUnitRate: "8", grnUnitCost: "10", matchedQuantity: "5" }),
    ).toBe("-10.000000");
  });
});

describe("calculateMatchTaxVariance", () => {
  it("is zero when the invoice's attributed tax equals the GRN-derived tax", () => {
    expect(
      calculateMatchTaxVariance({
        invoiceLineTaxAmount: "130",
        invoiceLineInvoicedQuantity: "10",
        matchedQuantity: "10",
        grnDerivedTaxAmount: "130",
      }),
    ).toBe("0.000000");
  });
  it("is positive when the invoice attributes more tax than the GRN basis", () => {
    expect(
      calculateMatchTaxVariance({
        invoiceLineTaxAmount: "150",
        invoiceLineInvoicedQuantity: "10",
        matchedQuantity: "10",
        grnDerivedTaxAmount: "130",
      }),
    ).toBe("20.000000");
  });
});
