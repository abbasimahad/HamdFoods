import Decimal from "decimal.js";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { expectBalancedJournal } from "@/test/accounting-assertions";
import {
  createManualJournalDraft,
  postAutomaticJournal,
  postCustomerPaymentAccounting,
  postDirectAccountJournal,
  postSalesInvoiceAccounting,
  reverseCustomerPaymentAccounting,
} from "./transactional-accounting-posting";

describe("automatic accounting integrity", () => {
  it("posts balanced sales revenue and valuation-based COGS exactly once", async () => {
    const tx = accountingTx();
    tx.salesInvoice.findUnique.mockResolvedValue({
      id: "invoice-1",
      number: "INV-1",
      status: "POSTED",
      invoiceDate: new Date("2026-01-15T00:00:00.000Z"),
      customerId: "customer-1",
      subtotal: "100000",
      discountTotal: "5000",
      taxTotal: "17100",
      grandTotal: "112100",
      lines: [],
    });
    tx.inventoryValuationEntry.aggregate.mockResolvedValue({ _sum: { valueDelta: "-60000" } });

    await postSalesInvoiceAccounting(tx.client, "invoice-1", "actor-1");
    await postSalesInvoiceAccounting(tx.client, "invoice-1", "actor-1");

    expect(tx.journals()).toHaveLength(2);
    const [revenue, cogs] = tx.journals();
    expectBalancedJournal(revenue!);
    expectBalancedJournal(cogs!);
    expect(revenue!.lines.create).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ debit: "112100.000000", credit: "0.000000" }),
        expect.objectContaining({ debit: "5000.000000", credit: "0.000000" }),
        expect.objectContaining({ debit: "0.000000", credit: "100000.000000" }),
        expect.objectContaining({ debit: "0.000000", credit: "17100.000000" }),
      ]),
    );
    expect(cogs!.lines.create).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ debit: "60000.000000", credit: "0.000000" }),
        expect.objectContaining({ debit: "0.000000", credit: "60000.000000" }),
      ]),
    );
  });

  it("reconciles customer AR and treasury after a payment reversal", async () => {
    const tx = accountingTx();
    tx.customerPayment.findUnique
      .mockResolvedValueOnce({
        id: "payment-1",
        number: "RCPT-1",
        status: "POSTED",
        paymentDate: new Date("2026-01-10T00:00:00.000Z"),
        method: "CASH",
        totalAmount: "40000",
        customerId: "customer-1",
        reversalOfId: null,
        reversalReason: null,
      })
      .mockResolvedValueOnce({
        id: "payment-reversal-1",
        number: "RCPT-2",
        status: "POSTED",
        paymentDate: new Date("2026-01-20T00:00:00.000Z"),
        method: "CASH",
        totalAmount: "40000",
        customerId: "customer-1",
        reversalOfId: "payment-1",
        reversalReason: "Returned receipt",
      });

    await postCustomerPaymentAccounting(tx.client, "payment-1", "actor-1");
    await reverseCustomerPaymentAccounting(tx.client, "payment-reversal-1", "actor-1");
    const [payment, reversal] = tx.journals();
    expectBalancedJournal(payment!);
    expectBalancedJournal(reversal!);
    expect(accountNet([payment!, reversal!], "ACCOUNTS_RECEIVABLE")).toBe("0");
    expect(accountNet([payment!, reversal!], "DEFAULT_CASH")).toBe("0");
  });

  it.each([
    ["SUPPLIER_PAYMENT", "AP", "TREASURY"],
    ["EXPENSE_VOUCHER", "EXPENSE", "TREASURY"],
    ["TREASURY_TRANSFER", "DESTINATION_TREASURY", "SOURCE_TREASURY"],
    ["PRODUCTION_CONSUMPTION", "WIP", "RAW_INVENTORY"],
    ["PACKAGING_CONSUMPTION", "WIP", "PACKAGING_INVENTORY"],
    ["PRODUCTION_OUTPUT", "FINISHED_GOODS_INVENTORY", "WIP"],
  ] as const)("posts a balanced %s journal", async (sourceType, debitAccount, creditAccount) => {
    const tx = accountingTx();
    await postDirectAccountJournal(tx.client, {
      sourceType,
      sourceId: `${sourceType}-1`,
      accountingDate: new Date("2026-01-15T00:00:00.000Z"),
      description: sourceType,
      actorUserId: "actor-1",
      lines: [
        { accountId: debitAccount, debit: "100" },
        { accountId: creditAccount, credit: "100" },
      ],
    });
    expectBalancedJournal(tx.journals()[0]!);
  });

  it.each(["AR", "AP", "INVENTORY", "WIP"])(
    "rejects manual posting to the %s control account before creating a draft",
    async (controlAccount) => {
      const tx = accountingTx();
      tx.accountingAccount.findMany.mockResolvedValue([
        { id: controlAccount, active: true, postingAllowed: true, isControl: true },
        { id: "OTHER", active: true, postingAllowed: true, isControl: false },
      ]);
      await expect(
        createManualJournalDraft(tx.client, {
          accountingDate: new Date("2026-01-15T00:00:00.000Z"),
          description: "Forbidden control entry",
          actorUserId: "actor-1",
          lines: [
            { accountId: controlAccount, debit: "100" },
            { accountId: "OTHER", credit: "100" },
          ],
        }),
      ).rejects.toThrow(/control accounts/i);
      expect(tx.journals()).toHaveLength(0);
    },
  );

  it("records a control block instead of posting into a closed accounting period", async () => {
    const tx = accountingTx();
    tx.accountingPeriod.findFirst.mockResolvedValue(null);

    await expect(
      postAutomaticJournal(tx.client, {
        sourceType: "SALES_INVOICE_REVENUE",
        sourceId: "closed-period-source",
        accountingDate: new Date("2026-01-15T00:00:00.000Z"),
        description: "Closed-period assertion",
        actorUserId: "actor-1",
        lines: [
          { mapping: "ACCOUNTS_RECEIVABLE", debit: "100" },
          { mapping: "SALES_REVENUE", credit: "100" },
        ],
      }),
    ).resolves.toEqual({ journalId: null, blocked: true });
    expect(tx.journals()).toHaveLength(0);
    expect(tx.accountingPostingBlock.upsert).toHaveBeenCalledOnce();
  });
});

type CapturedJournal = {
  sourceType: string;
  sourceId: string;
  totalDebit: string;
  totalCredit: string;
  lines: { create: Array<Record<string, unknown> & { debit: string; credit: string }> };
};

function accountingTx() {
  const journals: CapturedJournal[] = [];
  let sequence = 1;
  const mappings = [
    "ACCOUNTS_RECEIVABLE",
    "SALES_DISCOUNTS",
    "SALES_REVENUE",
    "OUTPUT_TAX",
    "COST_OF_GOODS_SOLD",
    "FINISHED_GOODS_INVENTORY",
    "DEFAULT_CASH",
    "DEFAULT_BANK",
  ].map((mappingKey) => ({
    mappingKey,
    account: { id: mappingKey, active: true, postingAllowed: true },
  }));
  const accountingJournal = {
    findUnique: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
      const key = where.sourceType_sourceId as { sourceType: string; sourceId: string } | undefined;
      const found = key
        ? journals.find(
            (journal) => journal.sourceType === key.sourceType && journal.sourceId === key.sourceId,
          )
        : undefined;
      return found ? { id: `${found.sourceType}:${found.sourceId}` } : null;
    }),
    create: vi.fn(async ({ data }: { data: (typeof journals)[number] }) => {
      journals.push(data);
      return { id: `journal-${journals.length}`, journalNumber: `JV-${journals.length}`, ...data };
    }),
  };
  const accountingAccount = {
    findMany: vi.fn(async ({ where }: { where: { id: { in: string[] } } }) =>
      where.id.in.map((id) => ({ id, active: true, postingAllowed: true, isControl: false })),
    ),
  };
  const client = {
    salesInvoice: { findUnique: vi.fn() },
    customerPayment: { findUnique: vi.fn() },
    inventoryValuationEntry: { aggregate: vi.fn() },
    accountingJournal,
    accountingJournalSequence: {
      upsert: vi.fn(async () => ({ nextValue: ++sequence })),
    },
    accountingAccount,
    accountingSettings: { findUnique: vi.fn(async () => ({ mappings })) },
    accountingPeriod: { findFirst: vi.fn(async () => ({ id: "period-1" })) },
    accountingPostingBlock: {
      updateMany: vi.fn(async () => ({ count: 0 })),
      upsert: vi.fn(async () => ({})),
    },
    auditEvent: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
        id: "audit-1",
        ...data,
      })),
    },
  };
  return {
    client: client as never,
    salesInvoice: client.salesInvoice,
    customerPayment: client.customerPayment,
    inventoryValuationEntry: client.inventoryValuationEntry,
    accountingAccount,
    accountingPeriod: client.accountingPeriod,
    accountingPostingBlock: client.accountingPostingBlock,
    journals: () => journals,
  };
}

function accountNet(journals: CapturedJournal[], accountId: string) {
  return journals
    .flatMap((journal) => journal.lines.create)
    .filter((line) => {
      const account = line.account as { connect?: { id?: string } } | undefined;
      return account?.connect?.id === accountId;
    })
    .reduce((sum, line) => sum.add(line.debit).sub(line.credit), new Decimal(0))
    .toFixed();
}
