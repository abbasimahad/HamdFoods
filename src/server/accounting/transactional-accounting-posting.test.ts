import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import * as posting from "./transactional-accounting-posting";

describe("automatic accounting audit classification", () => {
  it("classifies operational sources independently from the journal created for them", () => {
    const sourceType = Reflect.get(posting, "accountingSourceAuditEntityType") as
      ((sourceType: string) => string) | undefined;

    expect(sourceType).toBeTypeOf("function");
    expect(sourceType!("SALES_INVOICE_REVENUE")).toBe("SALES_INVOICE");
    expect(sourceType!("CUSTOMER_PAYMENT")).toBe("CUSTOMER_PAYMENT");
    expect(sourceType!("GOODS_RECEIPT")).toBe("GRN");
    expect(sourceType!("PRODUCTION_OUTPUT")).toBe("COSTING_FINALIZATION");
    expect(sourceType!("MANUAL_JOURNAL")).toBe("JOURNAL");
  });

  it("records an attributable block when a required account mapping is unavailable", async () => {
    const blockUpsert = vi.fn(async () => ({}));
    const auditCreate = vi.fn(async () => ({}));
    const tx = {
      accountingJournal: { findUnique: vi.fn(async () => null) },
      accountingSettings: {
        findUnique: vi.fn(async () => ({ mappings: [] })),
      },
      accountingPeriod: { findFirst: vi.fn(async () => ({ id: "period-id" })) },
      accountingPostingBlock: { upsert: blockUpsert },
      auditEvent: { create: auditCreate },
    } as never;

    await expect(
      posting.postAutomaticJournal(tx, {
        sourceType: "CUSTOMER_PAYMENT",
        sourceId: "payment-id",
        sourceNumber: "CPAY-1",
        accountingDate: new Date("2026-08-30T00:00:00.000Z"),
        description: "Customer payment.",
        actorUserId: "actor-id",
        lines: [
          { mapping: "DEFAULT_CASH", debit: "10" },
          { mapping: "ACCOUNTS_RECEIVABLE", credit: "10" },
        ],
      }),
    ).resolves.toEqual({ journalId: null, blocked: true });
    expect(blockUpsert).toHaveBeenCalledOnce();
    expect(auditCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: "CONTROL_BLOCKED",
        entityType: "CUSTOMER_PAYMENT",
        entityId: "payment-id",
      }),
    });
  });
});
