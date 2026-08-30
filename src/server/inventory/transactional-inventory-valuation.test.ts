import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { postValuedInbound, postValuedOutbound } from "./transactional-inventory-valuation";

describe("moving weighted-average valuation", () => {
  it("recalculates inbound average and relieves outbound at that average", async () => {
    const tx = valuationTx();
    await postValuedInbound(tx.client, inbound("receipt-1", "100", "200"));
    await postValuedInbound(tx.client, inbound("receipt-2", "50", "260"));
    await postValuedOutbound(tx.client, outbound("sale-1", "40"));

    expect(tx.balance()).toMatchObject({
      ownedQuantity: "110.000000",
      inventoryValue: "24200.000000",
      averageUnitCost: "220.000000000000",
    });
    expect(tx.entries()[2]).toMatchObject({
      quantityEffect: "-40",
      valueDelta: "-8800.000000",
      runningOwnedQuantity: "110.000000",
      runningInventoryValue: "24200.000000",
    });
  });

  it("forces value to zero when the quantity is exhausted", async () => {
    const tx = valuationTx({
      ownedQuantity: "40",
      inventoryValue: "8800",
      averageUnitCost: "220",
    });
    await postValuedOutbound(tx.client, outbound("sale-final", "40"));
    expect(tx.balance()).toMatchObject({
      ownedQuantity: "0.000000",
      inventoryValue: "0.000000",
      averageUnitCost: "0.000000000000",
    });
  });

  it("is source-idempotent", async () => {
    const tx = valuationTx();
    await postValuedInbound(tx.client, inbound("receipt-1", "100", "200"));
    await postValuedInbound(tx.client, inbound("receipt-1", "100", "200"));
    expect(tx.entries()).toHaveLength(1);
    expect(tx.balance().inventoryValue).toBe("20000.000000");
  });
});

function inbound(sourceKey: string, quantity: string, unitCost: string) {
  return {
    sourceKey,
    itemId: "item-1",
    entryType: "PURCHASE_RECEIPT" as const,
    effectiveAt: new Date("2026-01-10T00:00:00.000Z"),
    sourceType: "GOODS_RECEIPT",
    actorUserId: "actor-1",
    quantity,
    unitCost,
  };
}

function outbound(sourceKey: string, quantity: string) {
  return {
    sourceKey,
    itemId: "item-1",
    entryType: "SALES_OUT" as const,
    effectiveAt: new Date("2026-01-20T00:00:00.000Z"),
    sourceType: "SALES_INVOICE",
    actorUserId: "actor-1",
    quantity,
  };
}

function valuationTx(
  initial: {
    ownedQuantity?: string;
    inventoryValue?: string;
    averageUnitCost?: string | null;
  } = {},
) {
  const balance = {
    itemId: "item-1",
    ownedQuantity: initial.ownedQuantity ?? "0",
    inventoryValue: initial.inventoryValue ?? "0",
    averageUnitCost: initial.averageUnitCost ?? null,
    missingBasisCount: 0,
    lastValuationAt: null as Date | null,
  };
  const entries: Record<string, unknown>[] = [];
  const client = {
    inventoryValuationEntry: {
      findUnique: vi.fn(async ({ where }: { where: { sourceKey: string } }) =>
        entries.find((entry) => entry.sourceKey === where.sourceKey) ? { id: "entry" } : null,
      ),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        entries.push(data);
        return { id: `entry-${entries.length}`, ...data };
      }),
    },
    inventoryValuationBalance: {
      upsert: vi.fn(async () => balance),
      findUniqueOrThrow: vi.fn(async () => ({ ...balance })),
      update: vi.fn(async ({ data }: { data: Partial<typeof balance> }) => {
        Object.assign(balance, data);
        return balance;
      }),
    },
    $queryRaw: vi.fn(async () => []),
  } as never;
  return { client, entries: () => entries, balance: () => ({ ...balance }) };
}
