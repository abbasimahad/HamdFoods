import { describe, expect, it } from "vitest";

import {
  effectiveCustomerPaymentWhere,
  effectiveSupplierPaymentWhere,
  isEffectivePostedPayment,
} from "@/server/accounting/payment-effectiveness";
import { customerInvoiceSettlement } from "./customer-invoice-settlement";

describe("customer invoice settlement", () => {
  it.each([
    ["50000", ["20000"], [], "30000"],
    ["50000", [], ["-10000"], "40000"],
    ["50000", ["20000"], ["-10000"], "20000"],
  ])("settles invoice %s with payments and returns", (grandTotal, payments, returns, expected) => {
    const settlement = customerInvoiceSettlement({
      grandTotal,
      paymentAllocations: payments.map((allocatedAmount) => ({ allocatedAmount })),
      salesReturns: returns.map((signedAmount) => ({ ledgerEntry: { signedAmount } })),
    });
    expect(settlement.presentationOutstanding.toFixed()).toBe(expected);
  });

  it("caps presentation outstanding without erasing excess ledger credit", () => {
    const settlement = customerInvoiceSettlement({
      grandTotal: "50000",
      paymentAllocations: [{ allocatedAmount: "50000" }],
      salesReturns: [{ ledgerEntry: { signedAmount: "-10000" } }],
    });
    expect(settlement.rawOutstanding.toFixed()).toBe("-10000");
    expect(settlement.presentationOutstanding.toFixed()).toBe("0");
  });
});

describe("payment reversal effectiveness", () => {
  it("allows only an unreversed original posted payment to allocate", () => {
    expect(
      isEffectivePostedPayment({ status: "POSTED", reversalOfId: null, reversalPayment: null }),
    ).toBe(true);
    expect(
      isEffectivePostedPayment({
        status: "POSTED",
        reversalOfId: "original-id",
        reversalPayment: null,
      }),
    ).toBe(false);
    expect(
      isEffectivePostedPayment({
        status: "POSTED",
        reversalOfId: null,
        reversalPayment: { paymentDate: new Date("2026-01-20T00:00:00.000Z") },
      }),
    ).toBe(false);
  });

  it("preserves payment effectiveness only before the reversal date", () => {
    const before = new Date("2026-01-15T00:00:00.000Z");
    const after = new Date("2026-01-25T00:00:00.000Z");
    expect(effectiveCustomerPaymentWhere(before)).toEqual(effectiveSupplierPaymentWhere(before));
    expect(effectiveCustomerPaymentWhere(before)).toMatchObject({
      paymentDate: { lte: before },
      OR: [
        { reversalPayment: { is: null } },
        { reversalPayment: { is: { paymentDate: { gt: before } } } },
      ],
    });
    expect(effectiveSupplierPaymentWhere(after)).toMatchObject({ paymentDate: { lte: after } });
  });
});
