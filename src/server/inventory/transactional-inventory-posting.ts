import "server-only";

import { randomUUID } from "node:crypto";
import Decimal from "decimal.js";

import type { Prisma } from "@/generated/prisma/client";
import { InventoryRepositoryError } from "@/modules/inventory/application/contracts";
import {
  isSupportedQuantityUnitCode,
  supportedQuantityUnitDimension,
} from "@/modules/quantity/domain/quantity";

export type PurchaseReceiptInventoryCommand = {
  itemId: string;
  warehouseId: string;
  canonicalUnitId: string;
  quantity: string;
  inventoryLotId: string;
  goodsReceiptId: string;
  goodsReceiptNumber: string;
  receiptLineId: string;
  actorUserId: string;
};

export type ReceiptQcInventoryCommand = PurchaseReceiptInventoryCommand & {
  acceptedQuantity: string;
  rejectedQuantity: string;
  rejectionReason?: string | undefined;
};

export type PurchasedMaterialQuarantineCommand = {
  operationId: string;
  itemId: string;
  warehouseId: string;
  canonicalUnitId: string;
  quantity: string;
  inventoryLotId: string;
  sourceGoodsReceiptId: string;
  reason: string;
  actorUserId: string;
};

export type PurchaseReturnInventoryCommand = {
  purchaseReturnId: string;
  purchaseReturnNumber: string;
  purchaseReturnLineId: string;
  itemId: string;
  warehouseId: string;
  canonicalUnitId: string;
  quantity: string;
  inventoryLotId: string;
  sourceGoodsReceiptId: string;
  actorUserId: string;
};

export type ProductionMaterialInventoryCommand = {
  materialType: "RAW_MATERIAL" | "PACKAGING_MATERIAL";
  operation: "ISSUE" | "RETURN" | "CONSUMPTION" | "DAMAGE";
  transactionId: string;
  transactionNumber: string;
  transactionLineId: string;
  productionBatchId: string;
  batchNumber: string;
  itemId: string;
  custodyWarehouseId: string;
  destinationWarehouseId?: string | undefined;
  canonicalUnitId: string;
  quantity: string;
  inventoryLotId: string;
  reason: string;
  actorUserId: string;
};

export type ProductionOutputInventoryCommand = {
  outputType: "GOOD" | "REPROCESS" | "REJECTED" | "PROCESS_LOSS";
  transactionId: string;
  outputNumber: string;
  productionBatchId: string;
  productionLotId: string;
  itemId: string;
  warehouseId: string;
  canonicalUnitId: string;
  quantity: string;
  reason: string;
  actorUserId: string;
};

export async function postProductionOutputInventory(
  transaction: Prisma.TransactionClient,
  command: ProductionOutputInventoryCommand,
) {
  if (command.outputType === "PROCESS_LOSS") return;
  const quantity = exactPositive(command.quantity, "Production output quantity");
  const [batch, lot, item, warehouse, unit] = await Promise.all([
    transaction.productionBatch.findUnique({ where: { id: command.productionBatchId } }),
    transaction.productionLot.findUnique({ where: { id: command.productionLotId } }),
    transaction.item.findFirst({
      where: { id: command.itemId, itemType: "FINISHED_GOOD", active: true },
      include: { stockUnit: true },
    }),
    transaction.warehouse.findFirst({ where: { id: command.warehouseId, active: true } }),
    transaction.unit.findFirst({ where: { id: command.canonicalUnitId, active: true } }),
  ]);
  const expectedUnit =
    command.outputType === "GOOD" ? item?.stockUnitId : batch?.productContentCanonicalUnitId;
  if (
    !batch ||
    batch.status !== "IN_PROGRESS" ||
    batch.finishedGoodId !== command.itemId ||
    !lot ||
    lot.productionBatchId !== batch.id ||
    lot.finishedGoodId !== command.itemId ||
    !item ||
    !warehouse ||
    !unit ||
    expectedUnit !== command.canonicalUnitId ||
    (command.outputType === "GOOD" &&
      (!isSupportedQuantityUnitCode(unit.code) || unit.dimension !== "COUNT"))
  )
    throw new InventoryRepositoryError(
      "reference",
      "Production output batch, lot, item, warehouse, quantity unit, or status is invalid.",
    );
  const effect =
    command.outputType === "GOOD"
      ? { status: "AVAILABLE" as const, movementType: "PRODUCTION_OUTPUT" as const }
      : command.outputType === "REPROCESS"
        ? { status: "REPROCESS" as const, movementType: "PRODUCTION_REPROCESS_OUTPUT" as const }
        : { status: "SCRAP" as const, movementType: "PRODUCTION_REJECTED_OUTPUT" as const };
  await transaction.inventoryMovement.create({
    data: {
      itemId: command.itemId,
      warehouseId: command.warehouseId,
      status: effect.status,
      quantity,
      canonicalUnitId: command.canonicalUnitId,
      movementType: effect.movementType,
      referenceType: "PRODUCTION_OUTPUT_TRANSACTION",
      referenceId: command.transactionId,
      sourceKey: `POT:${command.transactionId}:${command.outputType}`,
      groupId: command.transactionId,
      productionBatchId: command.productionBatchId,
      productionOutputTransactionId: command.transactionId,
      productionLotId: command.productionLotId,
      reason: command.reason,
      createdByUserId: command.actorUserId,
    },
  });
}

export async function postProductionMaterialInventory(
  transaction: Prisma.TransactionClient,
  command: ProductionMaterialInventoryCommand,
) {
  const quantity = exactPositive(command.quantity, "Production material quantity");
  const warehouseIds = [
    command.custodyWarehouseId,
    ...(command.destinationWarehouseId ? [command.destinationWarehouseId] : []),
  ];
  const [item, warehouseCount, unit, lot] = await Promise.all([
    transaction.item.findFirst({
      where: { id: command.itemId, itemType: command.materialType, active: true },
      include: { stockUnit: true },
    }),
    transaction.warehouse.count({
      where: { id: { in: [...new Set(warehouseIds)] }, active: true },
    }),
    transaction.unit.findFirst({ where: { id: command.canonicalUnitId, active: true } }),
    transaction.inventoryLot.findUnique({ where: { id: command.inventoryLotId } }),
  ]);
  if (
    !item ||
    warehouseCount !== new Set(warehouseIds).size ||
    !unit ||
    !lot ||
    lot.itemId !== command.itemId ||
    item.stockUnitId !== command.canonicalUnitId ||
    !isSupportedQuantityUnitCode(unit.code) ||
    supportedQuantityUnitDimension(unit.code) !== unit.dimension
  ) {
    throw new InventoryRepositoryError(
      "reference",
      "Production material item, lot, warehouse, or canonical unit is invalid.",
    );
  }
  if (command.materialType === "RAW_MATERIAL" && command.operation === "DAMAGE")
    throw new InventoryRepositoryError(
      "reference",
      "Raw-material damage is outside this production transaction workflow.",
    );

  const movementTypes =
    command.materialType === "RAW_MATERIAL"
      ? {
          issue: "PRODUCTION_ISSUE" as const,
          return: "PRODUCTION_RETURN" as const,
          consumption: "PRODUCTION_CONSUMPTION" as const,
        }
      : {
          issue: "PACKAGING_ISSUE" as const,
          return: "PACKAGING_RETURN" as const,
          consumption: "PACKAGING_CONSUMPTION" as const,
        };

  const common = {
    itemId: command.itemId,
    canonicalUnitId: command.canonicalUnitId,
    referenceType: "PRODUCTION_MATERIAL_TRANSACTION",
    referenceId: command.transactionId,
    groupId: command.transactionId,
    inventoryLotId: command.inventoryLotId,
    productionBatchId: command.productionBatchId,
    productionMaterialTransactionLineId: command.transactionLineId,
    reason: command.reason,
    createdByUserId: command.actorUserId,
  };
  if (command.operation === "ISSUE") {
    await requireProductionLotBalance(transaction, command, "AVAILABLE", quantity, false);
    await transaction.inventoryMovement.createMany({
      data: [
        {
          ...common,
          warehouseId: command.custodyWarehouseId,
          status: "AVAILABLE",
          quantity: new Decimal(quantity).negated().toFixed(),
          movementType: movementTypes.issue,
          sourceKey: `PMT:${command.transactionLineId}:ISSUE:AVAILABLE`,
        },
        {
          ...common,
          warehouseId: command.custodyWarehouseId,
          status: "IN_PRODUCTION",
          quantity,
          movementType: movementTypes.issue,
          sourceKey: `PMT:${command.transactionLineId}:ISSUE:CUSTODY`,
        },
      ],
    });
    return;
  }

  await requireProductionLotBalance(transaction, command, "IN_PRODUCTION", quantity, true);
  if (command.operation === "RETURN") {
    if (!command.destinationWarehouseId)
      throw new InventoryRepositoryError(
        "reference",
        "Material return requires a destination warehouse.",
      );
    await transaction.inventoryMovement.createMany({
      data: [
        {
          ...common,
          warehouseId: command.custodyWarehouseId,
          status: "IN_PRODUCTION",
          quantity: new Decimal(quantity).negated().toFixed(),
          movementType: movementTypes.return,
          sourceKey: `PMT:${command.transactionLineId}:RETURN:CUSTODY`,
        },
        {
          ...common,
          warehouseId: command.destinationWarehouseId,
          status: "AVAILABLE",
          quantity,
          movementType: movementTypes.return,
          sourceKey: `PMT:${command.transactionLineId}:RETURN:AVAILABLE`,
        },
      ],
    });
    return;
  }

  if (command.operation === "DAMAGE") {
    await transaction.inventoryMovement.createMany({
      data: [
        {
          ...common,
          warehouseId: command.custodyWarehouseId,
          status: "IN_PRODUCTION",
          quantity: new Decimal(quantity).negated().toFixed(),
          movementType: "PACKAGING_DAMAGE",
          sourceKey: `PMT:${command.transactionLineId}:DAMAGE:CUSTODY`,
        },
        {
          ...common,
          warehouseId: command.custodyWarehouseId,
          status: "DAMAGED",
          quantity,
          movementType: "PACKAGING_DAMAGE",
          sourceKey: `PMT:${command.transactionLineId}:DAMAGE:DAMAGED`,
        },
      ],
    });
    return;
  }

  await transaction.inventoryMovement.create({
    data: {
      ...common,
      warehouseId: command.custodyWarehouseId,
      status: "IN_PRODUCTION",
      quantity: new Decimal(quantity).negated().toFixed(),
      movementType: movementTypes.consumption,
      sourceKey: `PMT:${command.transactionLineId}:CONSUMPTION`,
    },
  });
}

export async function postPurchaseReceiptInventory(
  transaction: Prisma.TransactionClient,
  commands: readonly PurchaseReceiptInventoryCommand[],
) {
  if (commands.length === 0)
    throw new InventoryRepositoryError("reference", "Receipt has no inventory lines.");
  await validateReferences(transaction, commands, true);
  await transaction.inventoryMovement.createMany({
    data: commands.map((command) => ({
      itemId: command.itemId,
      warehouseId: command.warehouseId,
      status: "QUALITY_HOLD" as const,
      quantity: exactPositive(command.quantity, "Received quantity"),
      canonicalUnitId: command.canonicalUnitId,
      movementType: "PURCHASE_RECEIPT" as const,
      referenceType: "GOODS_RECEIPT",
      referenceId: command.goodsReceiptId,
      sourceKey: `GRN:${command.receiptLineId}:RECEIPT`,
      groupId: command.goodsReceiptId,
      inventoryLotId: command.inventoryLotId,
      reason: `Goods receipt ${command.goodsReceiptNumber} posted to quality hold.`,
      createdByUserId: command.actorUserId,
    })),
  });
}

export async function postReceiptQcInventory(
  transaction: Prisma.TransactionClient,
  commands: readonly ReceiptQcInventoryCommand[],
) {
  await validateReferences(transaction, commands, false);
  for (const command of commands) {
    const accepted = exactNonNegative(command.acceptedQuantity, "Accepted quantity");
    const rejected = exactNonNegative(command.rejectedQuantity, "Rejected quantity");
    const required = accepted.add(rejected);
    const balance = await transaction.inventoryMovement.aggregate({
      where: {
        itemId: command.itemId,
        warehouseId: command.warehouseId,
        status: "QUALITY_HOLD",
        inventoryLotId: command.inventoryLotId,
      },
      _sum: { quantity: true },
    });
    if (new Decimal(balance._sum.quantity?.toString() ?? "0").lt(required)) {
      throw new InventoryRepositoryError("stock", "Insufficient lot quantity in quality hold.");
    }
    if (accepted.gt(0)) {
      await createStatusPair(
        transaction,
        command,
        accepted,
        "AVAILABLE",
        "ACCEPTED",
        `QC accepted for ${command.goodsReceiptNumber}.`,
      );
    }
    if (rejected.gt(0)) {
      await createStatusPair(
        transaction,
        command,
        rejected,
        "QUARANTINE",
        "REJECTED",
        `QC rejected (${command.rejectionReason ?? "OTHER"}) for ${command.goodsReceiptNumber}.`,
      );
    }
  }
}

export async function quarantinePurchasedMaterialInventory(
  transaction: Prisma.TransactionClient,
  command: PurchasedMaterialQuarantineCommand,
) {
  const quantity = exactPositive(command.quantity, "Quarantine quantity");
  await validatePurchasedLotReference(transaction, command);
  await requireLotBalance(
    transaction,
    command.itemId,
    command.warehouseId,
    "AVAILABLE",
    command.inventoryLotId,
    quantity,
  );
  const groupId = randomUUID();
  const common = {
    itemId: command.itemId,
    warehouseId: command.warehouseId,
    canonicalUnitId: command.canonicalUnitId,
    referenceType: "PURCHASE_DEFECT_QUARANTINE",
    referenceId: command.operationId,
    groupId,
    inventoryLotId: command.inventoryLotId,
    reason: command.reason,
    createdByUserId: command.actorUserId,
  };
  await transaction.inventoryMovement.createMany({
    data: [
      {
        ...common,
        status: "AVAILABLE",
        quantity: new Decimal(quantity).negated().toFixed(),
        movementType: "STATUS_OUT",
        sourceKey: `PURCHASE-DEFECT:${command.operationId}:OUT`,
      },
      {
        ...common,
        status: "QUARANTINE",
        quantity,
        movementType: "STATUS_IN",
        sourceKey: `PURCHASE-DEFECT:${command.operationId}:IN`,
      },
    ],
  });
}

export async function postPurchaseReturnInventory(
  transaction: Prisma.TransactionClient,
  commands: readonly PurchaseReturnInventoryCommand[],
) {
  if (commands.length === 0)
    throw new InventoryRepositoryError("reference", "Purchase return has no inventory lines.");
  for (const command of commands) {
    const quantity = exactPositive(command.quantity, "Return quantity");
    await validatePurchasedLotReference(transaction, command);
    await requireLotBalance(
      transaction,
      command.itemId,
      command.warehouseId,
      "QUARANTINE",
      command.inventoryLotId,
      quantity,
    );
    await transaction.inventoryMovement.create({
      data: {
        itemId: command.itemId,
        warehouseId: command.warehouseId,
        status: "QUARANTINE",
        quantity: new Decimal(quantity).negated().toFixed(),
        canonicalUnitId: command.canonicalUnitId,
        movementType: "PURCHASE_RETURN",
        referenceType: "PURCHASE_RETURN",
        referenceId: command.purchaseReturnId,
        sourceKey: `PURCHASE-RETURN:${command.purchaseReturnLineId}`,
        groupId: command.purchaseReturnId,
        inventoryLotId: command.inventoryLotId,
        reason: `Supplier return ${command.purchaseReturnNumber}; goods left factory custody.`,
        createdByUserId: command.actorUserId,
      },
    });
  }
}

async function createStatusPair(
  transaction: Prisma.TransactionClient,
  command: ReceiptQcInventoryCommand,
  quantity: Decimal,
  destinationStatus: "AVAILABLE" | "QUARANTINE",
  classification: "ACCEPTED" | "REJECTED",
  reason: string,
) {
  const groupId = randomUUID();
  const common = {
    itemId: command.itemId,
    warehouseId: command.warehouseId,
    canonicalUnitId: command.canonicalUnitId,
    referenceType: "GOODS_RECEIPT_QC",
    referenceId: command.goodsReceiptId,
    sourceKey: `GRN:${command.receiptLineId}:QC:${classification}`,
    groupId,
    inventoryLotId: command.inventoryLotId,
    reason,
    createdByUserId: command.actorUserId,
  };
  await transaction.inventoryMovement.createMany({
    data: [
      {
        ...common,
        status: "QUALITY_HOLD",
        quantity: quantity.negated().toFixed(),
        movementType: "STATUS_OUT",
      },
      {
        ...common,
        status: destinationStatus,
        quantity: quantity.toFixed(),
        movementType: "STATUS_IN",
      },
    ],
  });
}

async function validateReferences(
  transaction: Prisma.TransactionClient,
  commands: readonly PurchaseReceiptInventoryCommand[],
  requireActiveItemAndUnit: boolean,
) {
  const itemIds = [...new Set(commands.map((command) => command.itemId))];
  const warehouseIds = [...new Set(commands.map((command) => command.warehouseId))];
  const unitIds = [...new Set(commands.map((command) => command.canonicalUnitId))];
  const lotIds = [...new Set(commands.map((command) => command.inventoryLotId))];
  const [items, warehouses, units, lots] = await Promise.all([
    transaction.item.findMany({
      where: {
        id: { in: itemIds },
        ...(requireActiveItemAndUnit ? { active: true } : {}),
      },
      select: { id: true, stockUnit: true },
    }),
    transaction.warehouse.findMany({
      where: { id: { in: warehouseIds }, active: true },
      select: { id: true },
    }),
    transaction.unit.findMany({
      where: {
        id: { in: unitIds },
        ...(requireActiveItemAndUnit ? { active: true } : {}),
      },
    }),
    transaction.inventoryLot.findMany({
      where: { id: { in: lotIds } },
      select: { id: true, itemId: true, sourceGoodsReceiptId: true },
    }),
  ]);
  if (
    items.length !== itemIds.length ||
    warehouses.length !== warehouseIds.length ||
    units.length !== unitIds.length ||
    lots.length !== lotIds.length
  ) {
    throw new InventoryRepositoryError(
      "reference",
      "Receipt inventory references are inactive or invalid.",
    );
  }
  for (const command of commands) {
    const item = items.find((row) => row.id === command.itemId)!;
    const unit = units.find((row) => row.id === command.canonicalUnitId)!;
    const lot = lots.find((row) => row.id === command.inventoryLotId)!;
    if (
      lot.itemId !== command.itemId ||
      lot.sourceGoodsReceiptId !== command.goodsReceiptId ||
      !isSupportedQuantityUnitCode(unit.code) ||
      supportedQuantityUnitDimension(unit.code) !== unit.dimension ||
      unit.dimension !== item.stockUnit.dimension
    ) {
      throw new InventoryRepositoryError(
        "reference",
        "Receipt lot, item, or canonical unit does not match.",
      );
    }
  }
}

async function validatePurchasedLotReference(
  transaction: Prisma.TransactionClient,
  command: {
    itemId: string;
    warehouseId: string;
    canonicalUnitId: string;
    inventoryLotId: string;
    sourceGoodsReceiptId: string;
  },
) {
  const [item, warehouse, unit, lot] = await Promise.all([
    transaction.item.findUnique({ where: { id: command.itemId }, include: { stockUnit: true } }),
    transaction.warehouse.findFirst({ where: { id: command.warehouseId, active: true } }),
    transaction.unit.findUnique({ where: { id: command.canonicalUnitId } }),
    transaction.inventoryLot.findUnique({ where: { id: command.inventoryLotId } }),
  ]);
  if (
    !item ||
    !warehouse ||
    !unit ||
    !lot ||
    lot.itemId !== command.itemId ||
    lot.sourceGoodsReceiptId !== command.sourceGoodsReceiptId ||
    item.stockUnitId !== command.canonicalUnitId ||
    !isSupportedQuantityUnitCode(unit.code) ||
    supportedQuantityUnitDimension(unit.code) !== unit.dimension ||
    unit.dimension !== item.stockUnit.dimension
  ) {
    throw new InventoryRepositoryError(
      "reference",
      "Purchased lot, item, warehouse, or canonical unit does not match.",
    );
  }
}

async function requireLotBalance(
  transaction: Prisma.TransactionClient,
  itemId: string,
  warehouseId: string,
  status: "AVAILABLE" | "QUARANTINE",
  inventoryLotId: string,
  required: string,
) {
  const balance = await transaction.inventoryMovement.aggregate({
    where: { itemId, warehouseId, status, inventoryLotId },
    _sum: { quantity: true },
  });
  if (new Decimal(balance._sum.quantity?.toString() ?? "0").lt(required)) {
    throw new InventoryRepositoryError(
      "stock",
      `Insufficient lot quantity in ${status.toLowerCase()}.`,
    );
  }
}

function exactPositive(value: string, label: string) {
  const parsed = exactNonNegative(value, label);
  if (parsed.lte(0))
    throw new InventoryRepositoryError("reference", `${label} must be greater than zero.`);
  return parsed.toFixed();
}

async function requireProductionLotBalance(
  transaction: Prisma.TransactionClient,
  command: ProductionMaterialInventoryCommand,
  status: "AVAILABLE" | "IN_PRODUCTION",
  required: string,
  batchSpecific: boolean,
) {
  const balance = await transaction.inventoryMovement.aggregate({
    where: {
      itemId: command.itemId,
      warehouseId: command.custodyWarehouseId,
      status,
      inventoryLotId: command.inventoryLotId,
      ...(batchSpecific ? { productionBatchId: command.productionBatchId } : {}),
    },
    _sum: { quantity: true },
  });
  if (new Decimal(balance._sum.quantity?.toString() ?? "0").lt(required)) {
    throw new InventoryRepositoryError(
      "stock",
      status === "AVAILABLE"
        ? "Insufficient AVAILABLE quantity for the selected lot."
        : "Insufficient batch-held IN_PRODUCTION quantity for the selected lot.",
    );
  }
}

function exactNonNegative(value: string, label: string) {
  let parsed: Decimal;
  try {
    parsed = new Decimal(value);
  } catch {
    throw new InventoryRepositoryError("reference", `${label} is invalid.`);
  }
  if (
    !parsed.isFinite() ||
    parsed.lt(0) ||
    parsed.decimalPlaces() > 6 ||
    parsed.gt("999999999999999999.999999")
  ) {
    throw new InventoryRepositoryError(
      "reference",
      `${label} is outside the supported canonical range.`,
    );
  }
  return parsed;
}
