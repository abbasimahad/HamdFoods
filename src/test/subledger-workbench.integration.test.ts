import Decimal from "decimal.js";
import { beforeAll, describe, expect, it } from "vitest";

import { payableAging, receivableAging } from "@/server/accounting/financial-reporting";
import { PrismaSubledgerWorkbench } from "@/server/accounting/prisma-subledger-workbench";
import { prisma } from "@/server/db/prisma";
import { executePhase27GoldenWorkflow, type Phase27WorkflowState } from "./phase27-golden-workflow";

const asOf = new Date("2026-12-31T00:00:00.000Z");
let state: Phase27WorkflowState;

beforeAll(async () => {
  state = await executePhase27GoldenWorkflow();
});

describe("source-derived receivable and payable workbenches", () => {
  it("reconciles party net and aging totals without creating accounting state", async () => {
    const workbench = new PrismaSubledgerWorkbench();
    const before = await mutationCounts();

    const [receivable, payable, receivables, payables, receivableReport, payableReport] =
      await Promise.all([
        workbench.getReceivable(state.customerId, asOf),
        workbench.getPayable(state.supplierId, asOf),
        workbench.listReceivables({ asOf, query: "", page: 1 }),
        workbench.listPayables({ asOf, query: "", page: 1 }),
        receivableAging(asOf),
        payableAging(asOf),
      ]);

    const [customerLedger, supplierLedger] = await Promise.all([
      prisma.customerLedgerEntry.aggregate({
        where: { customerId: state.customerId, entryDate: { lte: asOf } },
        _sum: { signedAmount: true },
      }),
      prisma.supplierPayableLedgerEntry.aggregate({
        where: { supplierId: state.supplierId, entryDate: { lte: asOf } },
        _sum: { signedAmount: true },
      }),
    ]);

    expect(receivable?.netBalance).toBe(
      new Decimal(customerLedger._sum.signedAmount?.toString() ?? 0).toFixed(6),
    );
    expect(payable?.netBalance).toBe(
      new Decimal(supplierLedger._sum.signedAmount?.toString() ?? 0).toFixed(6),
    );
    expect(sum(receivables.records.map((row) => row.aging.total))).toBe(receivableReport.total);
    expect(sum(payables.records.map((row) => row.aging.total))).toBe(payableReport.total);
    expect(receivable?.history.map((row) => row.id)).not.toContain(
      state.customerPaymentAllocationId,
    );
    expect(payable?.history.some((row) => row.type === "ALLOCATION")).toBe(false);
    expect(await mutationCounts()).toEqual(before);
  });
});

function sum(values: readonly string[]) {
  return values.reduce((total, value) => total.add(value), new Decimal(0)).toFixed(6);
}

async function mutationCounts() {
  const [
    customerLedger,
    supplierLedger,
    customerPayments,
    supplierPayments,
    invoices,
    journals,
    audit,
  ] = await Promise.all([
    prisma.customerLedgerEntry.count(),
    prisma.supplierPayableLedgerEntry.count(),
    prisma.customerPayment.count(),
    prisma.supplierPayment.count(),
    prisma.salesInvoice.count(),
    prisma.accountingJournal.count(),
    prisma.auditEvent.count(),
  ]);
  return {
    customerLedger,
    supplierLedger,
    customerPayments,
    supplierPayments,
    invoices,
    journals,
    audit,
  };
}
