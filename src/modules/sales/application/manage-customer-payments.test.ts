import { describe, expect, it, vi } from "vitest";

import type { ApplicationPrincipal } from "@/modules/access/domain/principal";
import * as payments from "./manage-customer-payments";
import type { CustomerPaymentRepository } from "./customer-payment-contracts";

type ReversibleCustomerPaymentRepository = CustomerPaymentRepository & {
  reverseCustomerPayment(
    id: string,
    actorUserId: string,
    reversalDate: Date,
    reason: string,
  ): Promise<string>;
};

const manager: ApplicationPrincipal = {
  id: "manager-id",
  name: "Manager",
  email: "manager@example.com",
  active: true,
  roleCodes: ["SALES_MANAGER"],
  permissions: ["sales.manage"],
};

describe("customer-payment reversal", () => {
  // Defect: a posted receipt cannot be corrected through the sales application boundary,
  // leaving cancellation as the only exposed path even though it must never alter posted truth.
  it("delegates an authorized reversal with its date and reason", async () => {
    const reverse = vi.fn(async () => "reversal-id");
    const reverseCustomerPayment = Reflect.get(payments, "reverseCustomerPayment") as
      | ((
          actor: ApplicationPrincipal,
          id: string,
          reversalDate: Date,
          reason: string,
          repository: ReversibleCustomerPaymentRepository,
        ) => Promise<string>)
      | undefined;

    expect(reverseCustomerPayment).toBeTypeOf("function");
    const reversalDate = new Date("2026-08-30T00:00:00.000Z");
    await expect(
      reverseCustomerPayment!(
        manager,
        "payment-id",
        reversalDate,
        "Receipt returned",
        repository(reverse),
      ),
    ).resolves.toBe("reversal-id");
    expect(reverse).toHaveBeenCalledWith(
      "payment-id",
      "manager-id",
      reversalDate,
      "Receipt returned",
    );
  });

  it("does not let an unprivileged caller reverse a receipt", async () => {
    const reverse = vi.fn(async () => "reversal-id");
    const reverseCustomerPayment = Reflect.get(payments, "reverseCustomerPayment") as
      | ((
          actor: ApplicationPrincipal,
          id: string,
          reversalDate: Date,
          reason: string,
          repository: ReversibleCustomerPaymentRepository,
        ) => Promise<string>)
      | undefined;

    expect(reverseCustomerPayment).toBeTypeOf("function");
    await expect(
      reverseCustomerPayment!(
        { ...manager, permissions: [] },
        "payment-id",
        new Date("2026-08-30T00:00:00.000Z"),
        "Receipt returned",
        repository(reverse),
      ),
    ).resolves.toMatchObject({ ok: false });
    expect(reverse).not.toHaveBeenCalled();
  });
});

function repository(
  reverseCustomerPayment: ReversibleCustomerPaymentRepository["reverseCustomerPayment"],
): ReversibleCustomerPaymentRepository {
  return {
    getCustomerPaymentReferences: vi.fn(async () => ({ customers: [] })),
    getOpenInvoices: vi.fn(async () => []),
    createCustomerPayment: vi.fn(async () => "payment-id"),
    updateCustomerPayment: vi.fn(async () => "payment-id"),
    getCustomerPayment: vi.fn(async () => null),
    listCustomerPayments: vi.fn(async () => ({ records: [], page: 1, pageCount: 1, total: 0 })),
    postCustomerPayment: vi.fn(async () => undefined),
    cancelCustomerPayment: vi.fn(async () => undefined),
    reverseCustomerPayment,
    allocatePostedCustomerCredit: vi.fn(async () => undefined),
    getCustomerStatement: vi.fn(async () => null),
    getCustomerAging: vi.fn(async () => ({
      current: "0",
      days1To30: "0",
      days31To60: "0",
      days61To90: "0",
      days90Plus: "0",
      overdue: "0",
    })),
  };
}
