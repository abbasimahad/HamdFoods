import { beforeAll, describe, expect, it } from "vitest";

import { prisma } from "@/server/db/prisma";
import { PrismaCustomerPaymentRepository } from "@/server/sales/prisma-customer-payment-repository";
import { executePhase27GoldenWorkflow, type Phase27WorkflowState } from "./phase27-golden-workflow";

let state: Phase27WorkflowState;

beforeAll(async () => {
  state = await executePhase27GoldenWorkflow();
});

describe("round-9 bug-log regressions", () => {
  it("CTRL-2: the same bank + cheque number is refused for another customer", async () => {
    const first = await prisma.customer.findUniqueOrThrow({ where: { id: state.customerId } });
    const second = await prisma.customer.upsert({
      where: { code: "R9-CUST" },
      create: {
        code: "R9-CUST",
        name: "Round 9 Second Customer",
        phone: "+92-300-0009009",
        address: "Test-only customer address",
        city: "Lahore",
        customerGroupId: first.customerGroupId,
        areaId: first.areaId,
        routeId: first.routeId,
        salespersonId: first.salespersonId,
        creditLimit: "1000000",
        paymentTermsDays: 30,
      },
      update: { active: true },
    });
    const payments = new PrismaCustomerPaymentRepository();
    const cheque = `CHQ-CTRL2-${Date.now()}`;
    const receipt = (customerId: string, bankName: string) => ({
      customerId,
      paymentDate: "2026-10-11",
      method: "CHEQUE" as const,
      totalAmount: "100",
      bankName,
      chequeNumber: cheque,
      chequeDate: "2026-10-11",
      allocations: [],
      actorUserId: state.actorUserId,
    });
    await payments.createCustomerPayment(receipt(first.id, "Meezan Bank"));
    // Same instrument (same bank and number, any letter case) under another customer: refused.
    await expect(
      payments.createCustomerPayment(receipt(second.id, " meezan bank ")),
    ).rejects.toThrow(/is already recorded on payment .* for Phase 27 Customer/);
    // Same number from a different bank is a different cheque: accepted.
    await expect(payments.createCustomerPayment(receipt(second.id, "HBL"))).resolves.toBeTruthy();
  });
});
