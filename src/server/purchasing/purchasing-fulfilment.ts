import "server-only";

import Decimal from "decimal.js";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";

type Client = Prisma.TransactionClient | PrismaClient;
type PoLine = {
  id: string;
  normalizedQuantity: { toString(): string };
};

export type AuthoritativeFulfilment = {
  purchaseOrderLineId: string;
  orderedQuantity: string;
  pendingQcQuantity: string;
  grossAcceptedQuantity: string;
  rejectedQuantity: string;
  returnedAcceptedQuantity: string;
  netAcceptedQuantity: string;
  remainingToReceive: string;
  remainingToFulfil: string;
};

export async function calculatePurchaseOrderFulfilment(
  client: Client,
  poLines: readonly PoLine[],
): Promise<readonly AuthoritativeFulfilment[]> {
  if (poLines.length === 0) return [];
  const ids = poLines.map((line) => line.id);
  const [receiptLines, returnedAccepted] = await Promise.all([
    client.goodsReceiptLine.findMany({
      where: {
        purchaseOrderLineId: { in: ids },
        goodsReceipt: { status: { in: ["POSTED", "QC_COMPLETED"] } },
      },
      include: { goodsReceipt: { select: { status: true } }, qcDecision: true },
    }),
    client.purchaseReturnLine.groupBy({
      by: ["purchaseOrderLineId"],
      where: {
        purchaseOrderLineId: { in: ids },
        source: "POST_ACCEPTANCE_DEFECT",
        replacementExpected: true,
        purchaseReturn: { status: { in: ["POSTED", "AWAITING_REPLACEMENT", "COMPLETED"] } },
      },
      _sum: { normalizedQuantity: true },
    }),
  ]);
  return poLines.map((line) => {
    const related = receiptLines.filter((row) => row.purchaseOrderLineId === line.id);
    const pending = sum(
      related
        .filter((row) => row.goodsReceipt.status === "POSTED")
        .map((row) => row.normalizedQuantity.toString()),
    );
    const accepted = sum(related.map((row) => row.qcDecision?.acceptedQuantity.toString() ?? "0"));
    const rejected = sum(related.map((row) => row.qcDecision?.rejectedQuantity.toString() ?? "0"));
    const returned =
      returnedAccepted
        .find((row) => row.purchaseOrderLineId === line.id)
        ?._sum.normalizedQuantity?.toString() ?? "0";
    const ordered = line.normalizedQuantity.toString();
    const net = Decimal.max(new Decimal(accepted).sub(returned), 0);
    return {
      purchaseOrderLineId: line.id,
      orderedQuantity: ordered,
      pendingQcQuantity: pending,
      grossAcceptedQuantity: accepted,
      rejectedQuantity: rejected,
      returnedAcceptedQuantity: returned,
      netAcceptedQuantity: net.toFixed(),
      remainingToReceive: Decimal.max(new Decimal(ordered).sub(net).sub(pending), 0).toFixed(),
      remainingToFulfil: Decimal.max(new Decimal(ordered).sub(net), 0).toFixed(),
    };
  });
}

export async function updatePurchaseOrderFulfilmentStatus(
  transaction: Client,
  purchaseOrderId: string,
) {
  const order = await transaction.purchaseOrder.findUnique({
    where: { id: purchaseOrderId },
    include: { lines: true },
  });
  if (!order || ["DRAFT", "CANCELLED", "CLOSED"].includes(order.status)) return;
  const progress = await calculatePurchaseOrderFulfilment(transaction, order.lines);
  const fullyAccepted = progress.every((line) =>
    new Decimal(line.netAcceptedQuantity).gte(line.orderedQuantity),
  );
  await transaction.purchaseOrder.update({
    where: { id: purchaseOrderId },
    data: { status: fullyAccepted ? "RECEIVED" : "PARTIALLY_RECEIVED" },
  });
}

function sum(values: readonly string[]) {
  return values.reduce((total, value) => total.add(value), new Decimal(0)).toFixed();
}
