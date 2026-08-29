import "server-only";

import Decimal from "decimal.js";
import type {
  InventoryValuationEntryType,
  InventoryValuationState,
  Prisma,
} from "@/generated/prisma/client";

export class InventoryValuationError extends Error {
  constructor(
    readonly reason: "missing-basis" | "insufficient-quantity" | "invalid-reference" | "conflict",
    message: string,
  ) {
    super(message);
  }
}

type BaseCommand = {
  sourceKey: string;
  itemId: string;
  inventoryMovementId?: string | undefined;
  entryType: InventoryValuationEntryType;
  effectiveAt: Date;
  sourceType: string;
  sourceId?: string | undefined;
  sourceNumber?: string | undefined;
  productionBatchId?: string | undefined;
  inventoryLotId?: string | undefined;
  productionLotId?: string | undefined;
  notes?: string | undefined;
  actorUserId: string;
};

export async function postValuedInbound(
  tx: Prisma.TransactionClient,
  command: BaseCommand & { quantity: string; unitCost: string; state?: InventoryValuationState },
) {
  if (await exists(tx, command.sourceKey)) return;
  const quantity = positive(command.quantity, "Inbound valuation quantity");
  const unitCost = nonNegative(command.unitCost, "Inbound unit cost");
  const valueDelta = money(quantity.mul(unitCost));
  const balance = await lockedBalance(tx, command.itemId);
  const runningQuantity = quantity6(balance.ownedQuantity.add(quantity));
  const runningValue = money(balance.inventoryValue.add(valueDelta));
  const average = runningQuantity.isZero()
    ? new Decimal(0)
    : unit12(runningValue.div(runningQuantity));
  await createEntry(tx, command, {
    state: command.state ?? "FINAL",
    quantityEffect: quantity,
    unitCost,
    valueDelta,
    runningQuantity,
    runningValue,
    average,
    missingBasisCount: balance.missingBasisCount,
  });
}

export async function postValuedOutbound(
  tx: Prisma.TransactionClient,
  command: BaseCommand & { quantity: string },
) {
  if (await exists(tx, command.sourceKey)) return;
  const quantity = positive(command.quantity, "Outbound valuation quantity");
  const balance = await lockedBalance(tx, command.itemId);
  if (balance.missingBasisCount > 0 || !balance.averageUnitCost)
    throw new InventoryValuationError(
      "missing-basis",
      "Inventory cannot leave the valuation pool while this item has unresolved cost basis.",
    );
  if (balance.ownedQuantity.lt(quantity))
    throw new InventoryValuationError(
      "insufficient-quantity",
      "Valuation quantity is lower than the physical outbound quantity.",
    );
  const unitCost = balance.averageUnitCost;
  const runningQuantity = quantity6(balance.ownedQuantity.sub(quantity));
  const calculated = money(quantity.mul(unitCost));
  const valueDelta = runningQuantity.isZero()
    ? balance.inventoryValue.negated()
    : calculated.negated();
  const runningValue = runningQuantity.isZero()
    ? new Decimal(0)
    : money(balance.inventoryValue.add(valueDelta));
  const average = runningQuantity.isZero()
    ? new Decimal(0)
    : unit12(runningValue.div(runningQuantity));
  await createEntry(tx, command, {
    state: "FINAL",
    quantityEffect: quantity.negated(),
    unitCost,
    valueDelta,
    runningQuantity,
    runningValue,
    average,
    missingBasisCount: balance.missingBasisCount,
  });
}

export async function postMissingValuationBasis(
  tx: Prisma.TransactionClient,
  command: BaseCommand & { quantity: string; reasonCode: string; description: string },
) {
  if (await exists(tx, command.sourceKey)) return;
  const quantity = positive(command.quantity, "Unvalued inbound quantity");
  const balance = await lockedBalance(tx, command.itemId);
  const runningQuantity = quantity6(balance.ownedQuantity.add(quantity));
  await tx.inventoryValuationIssue.create({
    data: {
      sourceKey: `ISSUE:${command.sourceKey}`,
      itemId: command.itemId,
      inventoryMovementId: command.inventoryMovementId ?? null,
      quantity: quantity.toFixed(),
      reasonCode: command.reasonCode,
      description: command.description,
    },
  });
  await createEntry(tx, command, {
    state: "MISSING_VALUATION_BASIS",
    quantityEffect: quantity,
    unitCost: null,
    valueDelta: null,
    runningQuantity,
    runningValue: balance.inventoryValue,
    average: null,
    missingBasisCount: balance.missingBasisCount + 1,
  });
}

export async function postHistoricalUnvaluedOutbound(
  tx: Prisma.TransactionClient,
  command: BaseCommand & { quantity: string },
) {
  if (await exists(tx, command.sourceKey)) return;
  const quantity = positive(command.quantity, "Historical outbound valuation quantity");
  const balance = await lockedBalance(tx, command.itemId);
  if (balance.ownedQuantity.lt(quantity))
    throw new InventoryValuationError(
      "insufficient-quantity",
      "Historical valuation quantity is lower than the physical outbound quantity.",
    );
  const runningQuantity = quantity6(balance.ownedQuantity.sub(quantity));
  const runningValue = runningQuantity.isZero() ? new Decimal(0) : balance.inventoryValue;
  await createEntry(tx, command, {
    state: "MISSING_VALUATION_BASIS",
    quantityEffect: quantity.negated(),
    unitCost: null,
    valueDelta: null,
    runningQuantity,
    runningValue,
    average: null,
    missingBasisCount: balance.missingBasisCount,
  });
}

export async function postValueAdjustment(
  tx: Prisma.TransactionClient,
  command: BaseCommand & {
    valueDelta: string;
    resolvedIssueId?: string | undefined;
    adjustmentId?: string | undefined;
  },
) {
  if (await exists(tx, command.sourceKey)) return;
  const valueDelta = signedMoney(command.valueDelta, "Valuation adjustment");
  const balance = await lockedBalance(tx, command.itemId);
  if (balance.ownedQuantity.lte(0))
    throw new InventoryValuationError(
      "invalid-reference",
      "A monetary valuation adjustment requires positive owned quantity.",
    );
  const runningValue = money(balance.inventoryValue.add(valueDelta));
  if (runningValue.lt(0))
    throw new InventoryValuationError(
      "invalid-reference",
      "A valuation adjustment cannot make inventory value negative.",
    );
  const missingBasisCount = command.resolvedIssueId
    ? Math.max(0, balance.missingBasisCount - 1)
    : balance.missingBasisCount;
  const average = missingBasisCount === 0 ? unit12(runningValue.div(balance.ownedQuantity)) : null;
  await createEntry(tx, command, {
    state: missingBasisCount === 0 ? "FINAL" : "PROVISIONAL",
    quantityEffect: new Decimal(0),
    unitCost: average,
    valueDelta,
    runningQuantity: balance.ownedQuantity,
    runningValue,
    average,
    missingBasisCount,
  });
  if (command.resolvedIssueId)
    await tx.inventoryValuationIssue.update({
      where: { id: command.resolvedIssueId },
      data: {
        resolvedAt: new Date(),
        resolvedByUserId: command.actorUserId,
        adjustmentId: command.adjustmentId ?? null,
      },
    });
}

export async function resolveExhaustedValuationIssue(
  tx: Prisma.TransactionClient,
  command: BaseCommand & { resolvedIssueId: string },
) {
  if (await exists(tx, command.sourceKey)) return;
  const balance = await lockedBalance(tx, command.itemId);
  if (!balance.ownedQuantity.isZero() || !balance.inventoryValue.isZero())
    throw new InventoryValuationError(
      "conflict",
      "A zero-value resolution is allowed only when the item has no remaining owned quantity or value.",
    );
  const missingBasisCount = Math.max(0, balance.missingBasisCount - 1);
  await createEntry(tx, command, {
    state: missingBasisCount === 0 ? "FINAL" : "PROVISIONAL",
    quantityEffect: new Decimal(0),
    unitCost: new Decimal(0),
    valueDelta: new Decimal(0),
    runningQuantity: new Decimal(0),
    runningValue: new Decimal(0),
    average: missingBasisCount === 0 ? new Decimal(0) : null,
    missingBasisCount,
  });
  await tx.inventoryValuationIssue.update({
    where: { id: command.resolvedIssueId },
    data: { resolvedAt: new Date(), resolvedByUserId: command.actorUserId },
  });
}

async function lockedBalance(tx: Prisma.TransactionClient, itemId: string) {
  await tx.inventoryValuationBalance.upsert({
    where: { itemId },
    create: { itemId },
    update: {},
  });
  await tx.$queryRaw`SELECT "itemId" FROM "inventory_valuation_balance" WHERE "itemId" = ${itemId} FOR UPDATE`;
  const row = await tx.inventoryValuationBalance.findUniqueOrThrow({ where: { itemId } });
  return {
    ownedQuantity: new Decimal(row.ownedQuantity.toString()),
    inventoryValue: new Decimal(row.inventoryValue.toString()),
    averageUnitCost: row.averageUnitCost ? new Decimal(row.averageUnitCost.toString()) : null,
    missingBasisCount: row.missingBasisCount,
  };
}

async function exists(tx: Prisma.TransactionClient, sourceKey: string) {
  return Boolean(
    await tx.inventoryValuationEntry.findUnique({ where: { sourceKey }, select: { id: true } }),
  );
}

async function createEntry(
  tx: Prisma.TransactionClient,
  command: BaseCommand,
  result: {
    state: InventoryValuationState;
    quantityEffect: Decimal;
    unitCost: Decimal | null;
    valueDelta: Decimal | null;
    runningQuantity: Decimal;
    runningValue: Decimal;
    average: Decimal | null;
    missingBasisCount: number;
  },
) {
  await tx.inventoryValuationEntry.create({
    data: {
      sourceKey: command.sourceKey,
      itemId: command.itemId,
      inventoryMovementId: command.inventoryMovementId ?? null,
      entryType: command.entryType,
      state: result.state,
      effectiveAt: command.effectiveAt,
      quantityEffect: result.quantityEffect.toFixed(),
      unitCost: result.unitCost?.toFixed(12) ?? null,
      valueDelta: result.valueDelta?.toFixed(6) ?? null,
      runningOwnedQuantity: result.runningQuantity.toFixed(6),
      runningInventoryValue: result.runningValue.toFixed(6),
      resultingAverageUnitCost: result.average?.toFixed(12) ?? null,
      sourceType: command.sourceType,
      sourceId: command.sourceId ?? null,
      sourceNumber: command.sourceNumber ?? null,
      productionBatchId: command.productionBatchId ?? null,
      inventoryLotId: command.inventoryLotId ?? null,
      productionLotId: command.productionLotId ?? null,
      notes: command.notes ?? null,
      createdByUserId: command.actorUserId,
    },
  });
  await tx.inventoryValuationBalance.update({
    where: { itemId: command.itemId },
    data: {
      ownedQuantity: result.runningQuantity.toFixed(6),
      inventoryValue: result.runningValue.toFixed(6),
      averageUnitCost: result.average?.toFixed(12) ?? null,
      missingBasisCount: result.missingBasisCount,
      lastValuationAt: command.effectiveAt,
    },
  });
}

function positive(value: string, label: string) {
  const amount = decimal(value, label);
  if (amount.lte(0) || amount.decimalPlaces() > 6) throw invalid(label);
  return amount;
}
function nonNegative(value: string, label: string) {
  const amount = decimal(value, label);
  if (amount.lt(0) || amount.decimalPlaces() > 12) throw invalid(label);
  return amount;
}
function signedMoney(value: string, label: string) {
  const amount = decimal(value, label);
  if (amount.isZero() || amount.decimalPlaces() > 6) throw invalid(label);
  return money(amount);
}
function decimal(value: string, label: string) {
  try {
    const amount = new Decimal(value);
    if (!amount.isFinite()) throw new Error();
    return amount;
  } catch {
    throw invalid(label);
  }
}
function invalid(label: string) {
  return new InventoryValuationError("invalid-reference", `${label} is invalid.`);
}
function money(value: Decimal) {
  return new Decimal(value.toDecimalPlaces(6, Decimal.ROUND_HALF_UP));
}
function quantity6(value: Decimal) {
  return new Decimal(value.toDecimalPlaces(6, Decimal.ROUND_HALF_UP));
}
function unit12(value: Decimal) {
  return new Decimal(value.toDecimalPlaces(12, Decimal.ROUND_HALF_UP));
}
