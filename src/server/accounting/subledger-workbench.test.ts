import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/server/db/prisma", () => ({ prisma: {} }));

import {
  PrismaSubledgerWorkbench,
  type SubledgerKind,
  type SubledgerParty,
  type SubledgerWorkbenchSource,
} from "./prisma-subledger-workbench";

const asOf = new Date("2026-09-09T00:00:00.000Z");

function source(): SubledgerWorkbenchSource {
  const parties = {
    receivable: [{ id: "customer-1", code: "C-1", name: "Customer One" }],
    payable: [{ id: "supplier-1", code: "S-1", name: "Supplier One" }],
  } as const;
  return {
    listParties: vi.fn(async (kind: SubledgerKind) => ({ records: parties[kind], total: 1 })),
    getParty: vi.fn(
      async (kind: SubledgerKind, id: string) =>
        parties[kind].find((party: SubledgerParty) => party.id === id) ?? null,
    ),
    loadPartyData: vi.fn(async (kind: SubledgerKind) => [
      {
        partyId: kind === "receivable" ? "customer-1" : "supplier-1",
        documents: [
          {
            id: "current",
            number: "DOC-CURRENT",
            date: new Date("2026-09-05T00:00:00.000Z"),
            dueDate: new Date("2026-09-10T00:00:00.000Z"),
            amount: "100.100001",
            allocations: [{ amount: "10.000001", date: asOf, effective: true }],
            credits: [{ amount: "5.1", date: asOf, effective: true }],
            effective: true,
          },
          {
            id: "old",
            number: "DOC-OLD",
            date: new Date("2026-05-01T00:00:00.000Z"),
            dueDate: new Date("2026-05-01T00:00:00.000Z"),
            amount: "50",
            allocations: [
              { amount: "10", date: asOf, effective: true },
              { amount: "999", date: asOf, effective: false },
            ],
            credits: [],
            effective: true,
          },
          {
            id: "future",
            number: "FUTURE",
            date: new Date("2026-10-01T00:00:00.000Z"),
            dueDate: new Date("2026-10-01T00:00:00.000Z"),
            amount: "500",
            allocations: [],
            credits: [],
            effective: true,
          },
          {
            id: "draft",
            number: "DRAFT",
            date: asOf,
            dueDate: asOf,
            amount: "500",
            allocations: [],
            credits: [],
            effective: false,
          },
        ],
        ledger: [
          {
            id: "l1",
            date: asOf,
            number: "INV-1",
            type: "INVOICE",
            description: "Invoice",
            signedAmount: "150.100001",
            effective: true,
          },
          {
            id: "l2",
            date: asOf,
            number: "PAY-1",
            type: "PAYMENT",
            description: "Payment",
            signedAmount: "-35.100001",
            effective: true,
          },
          {
            id: "l3",
            date: new Date("2026-10-01T00:00:00.000Z"),
            number: "FUTURE",
            type: "PAYMENT",
            description: "Future",
            signedAmount: "-50",
            effective: true,
          },
          {
            id: "l4",
            date: asOf,
            number: "CANCELLED",
            type: "PAYMENT",
            description: "Cancelled",
            signedAmount: "-50",
            effective: false,
          },
        ],
        allocations: [
          {
            id: "a1",
            date: asOf,
            number: "PAY-1 → DOC-CURRENT",
            type: "ALLOCATION",
            description: "Allocation",
            signedAmount: "-10.000001",
            effective: true,
          },
          {
            id: "a2",
            date: asOf,
            number: "REVERSED",
            type: "ALLOCATION",
            description: "Reversed allocation",
            signedAmount: "-999",
            effective: false,
          },
        ],
      },
    ]),
  };
}

describe("PrismaSubledgerWorkbench calculations", () => {
  it.each(["receivable", "payable"] as const)(
    "keeps %s outstanding, credits, history, and aging exact",
    async (kind) => {
      const workbench = new PrismaSubledgerWorkbench(source());
      const result =
        kind === "receivable"
          ? await workbench.listReceivables({ asOf, query: "", page: 1 })
          : await workbench.listPayables({ asOf, query: "", page: 1 });

      expect(result.records[0]).toMatchObject({
        outstandingBalance: "125.000000",
        creditsAvailable: "10.000000",
        netBalance: "115.000000",
        aging: {
          current: "85.000000",
          days1To30: "0.000000",
          days31To60: "0.000000",
          days61To90: "0.000000",
          days90Plus: "40.000000",
          total: "125.000000",
        },
      });
    },
  );

  it("returns typed effective history and null for an unknown party", async () => {
    const workbench = new PrismaSubledgerWorkbench(source());
    const detail = await workbench.getReceivable("customer-1", asOf);

    expect(detail?.history.map((row) => row.number)).toEqual([
      "INV-1",
      "PAY-1",
      "PAY-1 → DOC-CURRENT",
    ]);
    expect(await workbench.getPayable("missing", asOf)).toBeNull();
  });

  it("uses stable bounded party pagination and one bulk data load", async () => {
    const data = source();
    const workbench = new PrismaSubledgerWorkbench(data);

    await workbench.listReceivables({ asOf, query: " cust ", page: 2 });

    expect(data.listParties).toHaveBeenCalledWith("receivable", "cust", 2, 30);
    expect(data.loadPartyData).toHaveBeenCalledOnce();
  });
});
