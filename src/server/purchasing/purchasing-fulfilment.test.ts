import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { calculatePurchaseOrderFulfilment } from "./purchasing-fulfilment";

describe("purchase fulfilment", () => {
  it("keeps rejected and pending-QC quantities out of accepted fulfilment", async () => {
    const client = fakeClient({ returnedAccepted: "0" });
    await expect(
      calculatePurchaseOrderFulfilment(client, [{ id: "line-1", normalizedQuantity: "100" }]),
    ).resolves.toEqual([
      {
        purchaseOrderLineId: "line-1",
        orderedQuantity: "100",
        pendingQcQuantity: "20",
        grossAcceptedQuantity: "50",
        rejectedQuantity: "10",
        returnedAcceptedQuantity: "0",
        netAcceptedQuantity: "50",
        remainingToReceive: "30",
        remainingToFulfil: "50",
      },
    ]);
  });

  it("subtracts replacement-expected accepted returns once", async () => {
    const client = fakeClient({ returnedAccepted: "10" });
    const [result] = await calculatePurchaseOrderFulfilment(client, [
      { id: "line-1", normalizedQuantity: "100" },
    ]);
    expect(result).toMatchObject({
      grossAcceptedQuantity: "50",
      returnedAcceptedQuantity: "10",
      netAcceptedQuantity: "40",
      remainingToFulfil: "60",
    });
  });
});

function fakeClient({ returnedAccepted }: { returnedAccepted: string }) {
  return {
    goodsReceiptLine: {
      findMany: vi.fn(async () => [
        {
          purchaseOrderLineId: "line-1",
          normalizedQuantity: "60",
          goodsReceipt: { status: "QC_COMPLETED" },
          qcDecision: { acceptedQuantity: "50", rejectedQuantity: "10" },
        },
        {
          purchaseOrderLineId: "line-1",
          normalizedQuantity: "20",
          goodsReceipt: { status: "POSTED" },
          qcDecision: null,
        },
      ]),
    },
    purchaseReturnLine: {
      groupBy: vi.fn(async () =>
        returnedAccepted === "0"
          ? []
          : [
              {
                purchaseOrderLineId: "line-1",
                _sum: { normalizedQuantity: returnedAccepted },
              },
            ],
      ),
    },
  } as never;
}
