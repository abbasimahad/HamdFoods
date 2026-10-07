import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/server/db/prisma", () => ({ prisma: {} }));

const { cashCategory } = await import("./financial-reporting");

describe("cashCategory (BUG-33)", () => {
  it("classifies payment reversals with the payment they reverse", () => {
    expect(cashCategory("CUSTOMER_PAYMENT")).toBe("Operating");
    expect(cashCategory("CUSTOMER_PAYMENT_REVERSAL")).toBe("Operating");
    expect(cashCategory("SUPPLIER_PAYMENT")).toBe("Operating");
    expect(cashCategory("SUPPLIER_PAYMENT_REVERSAL")).toBe("Operating");
    expect(cashCategory("EXPENSE_VOUCHER")).toBe("Operating");
    expect(cashCategory("EXPENSE_REVERSAL")).toBe("Operating");
    expect(cashCategory("TREASURY_TRANSFER")).toBe("Operating");
  });

  it("keeps manual journals in the manually classified section", () => {
    expect(cashCategory("MANUAL_JOURNAL")).toBe("Other");
    expect(cashCategory("MANUAL_REVERSAL")).toBe("Other");
  });
});
