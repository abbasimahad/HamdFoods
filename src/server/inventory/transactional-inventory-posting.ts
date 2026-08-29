import "server-only";

import { randomUUID } from "node:crypto";
import Decimal from "decimal.js";

import type { InventoryMovementType, Prisma } from "@/generated/prisma/client";
import { InventoryRepositoryError } from "@/modules/inventory/application/contracts";
import {
  isCanonicalPieceUnit,
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

export type SalesOrderReservationInventoryCommand = {
  operation: "RESERVE" | "RELEASE";
  salesOrderId: string;
  salesOrderNumber: string;
  salesOrderLineId: string;
  itemId: string;
  warehouseId: string;
  canonicalUnitId: string;
  quantity: string;
  actorUserId: string;
};

export type SalesDispatchInventoryCommand = {
  salesDispatchId: string;
  salesDispatchNumber: string;
  salesDispatchLineId: string;
  salesDispatchAllocationId: string;
  salesOrderId: string;
  salesOrderLineId: string;
  itemId: string;
  warehouseId: string;
  canonicalUnitId: string;
  productionLotId: string;
  quantity: string;
  dispatchAt: Date;
  actorUserId: string;
};

export type SalesInvoiceInventoryCommand = {
  salesInvoiceId: string;
  salesInvoiceNumber: string;
  salesInvoiceLineId: string;
  salesInvoiceAllocationId: string;
  salesOrderId: string;
  salesOrderLineId: string;
  salesDispatchId: string;
  salesDispatchLineId: string;
  salesDispatchAllocationId: string;
  itemId: string;
  warehouseId: string;
  canonicalUnitId: string;
  productionLotId: string;
  quantity: string;
  actorUserId: string;
};

export type SalesReturnReceiptInventoryCommand = {
  salesReturnId: string;
  salesReturnNumber: string;
  salesReturnLineId: string;
  type: "INVOICED_RETURN" | "DISPATCH_REFUSAL";
  salesInvoiceId?: string | undefined;
  salesInvoiceLineId?: string | undefined;
  salesOrderId: string;
  salesDispatchId: string;
  salesDispatchLineId: string;
  salesDispatchAllocationId: string;
  itemId: string;
  warehouseId: string;
  canonicalUnitId: string;
  productionLotId: string;
  quantity: string;
  actorUserId: string;
};

export type SalesReturnInspectionInventoryCommand = {
  salesReturnId: string;
  salesReturnNumber: string;
  salesReturnLineId: string;
  salesReturnInspectionId: string;
  salesInvoiceId?: string | undefined;
  salesInvoiceLineId?: string | undefined;
  salesOrderId: string;
  salesDispatchId: string;
  salesDispatchLineId: string;
  salesDispatchAllocationId: string;
  itemId: string;
  warehouseId: string;
  canonicalUnitId: string;
  productionLotId: string;
  quantity: string;
  classification: "GOOD_RESALE" | "QUARANTINE" | "REPROCESS" | "DAMAGED" | "EXPIRED";
  reason: string;
  actorUserId: string;
};

export async function receiveSalesReturnInventory(
  transaction: Prisma.TransactionClient,
  commands: readonly SalesReturnReceiptInventoryCommand[],
) {
  if (!commands.length)
    throw new InventoryRepositoryError("reference", "Sales return has no lines.");
  const warehouseId = commands[0]!.warehouseId;
  if (commands.some((command) => command.warehouseId !== warehouseId))
    throw new InventoryRepositoryError(
      "reference",
      "A sales return must be received into one warehouse.",
    );
  const [warehouse, items, lots] = await Promise.all([
    transaction.warehouse.findFirst({ where: { id: warehouseId, active: true } }),
    transaction.item.findMany({
      where: {
        id: { in: [...new Set(commands.map((command) => command.itemId))] },
        itemType: "FINISHED_GOOD",
      },
      include: { stockUnit: true, finishedGoodProfile: true },
    }),
    transaction.productionLot.findMany({
      where: { id: { in: [...new Set(commands.map((command) => command.productionLotId))] } },
    }),
  ]);
  if (
    !warehouse ||
    items.length !== new Set(commands.map((command) => command.itemId)).size ||
    lots.length !== new Set(commands.map((command) => command.productionLotId)).size
  )
    throw new InventoryRepositoryError(
      "reference",
      "Sales return warehouse, item, or finished lot is invalid.",
    );
  for (const command of commands) {
    const quantity = new Decimal(exactPositive(command.quantity, "Return quantity"));
    const item = items.find((candidate) => candidate.id === command.itemId);
    const lot = lots.find((candidate) => candidate.id === command.productionLotId);
    if (
      !item ||
      !lot ||
      !item.finishedGoodProfile ||
      !isCanonicalPieceUnit(item.stockUnit) ||
      item.stockUnitId !== command.canonicalUnitId ||
      lot.finishedGoodId !== command.itemId
    )
      throw new InventoryRepositoryError(
        "reference",
        "Sales return line has incompatible finished-good provenance.",
      );
    if (command.type === "DISPATCH_REFUSAL") {
      const transit = await transaction.inventoryMovement.aggregate({
        where: {
          warehouseId,
          itemId: command.itemId,
          productionLotId: command.productionLotId,
          salesDispatchAllocationId: command.salesDispatchAllocationId,
          status: "IN_TRANSIT",
        },
        _sum: { quantity: true },
      });
      if (new Decimal(transit._sum.quantity?.toString() ?? "0").lt(quantity))
        throw new InventoryRepositoryError(
          "stock",
          "The refused dispatch allocation no longer has enough IN_TRANSIT stock.",
        );
    }
  }
  const groupId = randomUUID();
  const movements: Prisma.InventoryMovementCreateManyInput[] = [];
  for (const command of commands) {
    const common = {
      itemId: command.itemId,
      warehouseId: command.warehouseId,
      canonicalUnitId: command.canonicalUnitId,
      referenceType: "SALES_RETURN",
      referenceId: command.salesReturnId,
      groupId,
      reason: `Sales return ${command.salesReturnNumber} received into return inspection.`,
      createdByUserId: command.actorUserId,
      productionLotId: command.productionLotId,
      salesOrderId: command.salesOrderId,
      salesDispatchId: command.salesDispatchId,
      salesDispatchLineId: command.salesDispatchLineId,
      salesDispatchAllocationId: command.salesDispatchAllocationId,
      salesInvoiceId: command.salesInvoiceId ?? null,
      salesInvoiceLineId: command.salesInvoiceLineId ?? null,
      salesReturnId: command.salesReturnId,
      salesReturnLineId: command.salesReturnLineId,
    };
    if (command.type === "DISPATCH_REFUSAL")
      movements.push(
        {
          ...common,
          status: "IN_TRANSIT" as const,
          quantity: new Decimal(command.quantity).negated().toFixed(),
          movementType: "DISPATCH_REFUSAL_RETURN" as const,
          sourceKey: `SR:${command.salesReturnLineId}:REFUSAL:IN_TRANSIT`,
        },
        {
          ...common,
          status: "RETURN_INSPECTION" as const,
          quantity: command.quantity,
          movementType: "DISPATCH_REFUSAL_RETURN" as const,
          sourceKey: `SR:${command.salesReturnLineId}:REFUSAL:RETURN_INSPECTION`,
        },
      );
    else
      movements.push({
        ...common,
        status: "RETURN_INSPECTION" as const,
        quantity: command.quantity,
        movementType: "SALES_RETURN_RECEIPT" as const,
        sourceKey: `SR:${command.salesReturnLineId}:RECEIPT`,
      });
  }
  await transaction.inventoryMovement.createMany({ data: movements });
}

export async function inspectSalesReturnInventory(
  transaction: Prisma.TransactionClient,
  commands: readonly SalesReturnInspectionInventoryCommand[],
) {
  for (const command of commands) {
    const quantity = new Decimal(exactPositive(command.quantity, "Inspection quantity"));
    const [balance, lot] = await Promise.all([
      transaction.inventoryMovement.aggregate({
        where: {
          itemId: command.itemId,
          warehouseId: command.warehouseId,
          productionLotId: command.productionLotId,
          salesReturnLineId: command.salesReturnLineId,
          status: "RETURN_INSPECTION",
        },
        _sum: { quantity: true },
      }),
      transaction.productionLot.findUnique({
        where: { id: command.productionLotId },
        select: { expiryDate: true },
      }),
    ]);
    if (new Decimal(balance._sum.quantity?.toString() ?? "0").lt(quantity))
      throw new InventoryRepositoryError(
        "stock",
        "Return inspection stock no longer covers this classification.",
      );
    if (command.classification === "GOOD_RESALE" && lot?.expiryDate && lot.expiryDate <= new Date())
      throw new InventoryRepositoryError(
        "reference",
        "An expired finished lot cannot be returned to AVAILABLE stock.",
      );
  }
  const movementFor = {
    GOOD_RESALE: { status: "AVAILABLE" as const, type: "RETURN_TO_AVAILABLE" as const },
    QUARANTINE: { status: "QUARANTINE" as const, type: "RETURN_TO_QUARANTINE" as const },
    REPROCESS: { status: "REPROCESS" as const, type: "RETURN_TO_REPROCESS" as const },
    DAMAGED: { status: "DAMAGED" as const, type: "RETURN_TO_DAMAGED" as const },
    EXPIRED: { status: "EXPIRED" as const, type: "RETURN_TO_EXPIRED" as const },
  };
  const groupId = randomUUID();
  const movements: Prisma.InventoryMovementCreateManyInput[] = [];
  for (const command of commands) {
    const destination = movementFor[command.classification];
    const common = {
      itemId: command.itemId,
      warehouseId: command.warehouseId,
      canonicalUnitId: command.canonicalUnitId,
      movementType: destination.type,
      referenceType: "SALES_RETURN_INSPECTION",
      referenceId: command.salesReturnId,
      groupId,
      reason: command.reason,
      createdByUserId: command.actorUserId,
      productionLotId: command.productionLotId,
      salesOrderId: command.salesOrderId,
      salesDispatchId: command.salesDispatchId,
      salesDispatchLineId: command.salesDispatchLineId,
      salesDispatchAllocationId: command.salesDispatchAllocationId,
      salesInvoiceId: command.salesInvoiceId ?? null,
      salesInvoiceLineId: command.salesInvoiceLineId ?? null,
      salesReturnId: command.salesReturnId,
      salesReturnLineId: command.salesReturnLineId,
      salesReturnInspectionId: command.salesReturnInspectionId,
    };
    movements.push(
      {
        ...common,
        status: "RETURN_INSPECTION" as const,
        quantity: new Decimal(command.quantity).negated().toFixed(),
        sourceKey: `SR:${command.salesReturnInspectionId}:OUT`,
      },
      {
        ...common,
        status: destination.status,
        quantity: command.quantity,
        sourceKey: `SR:${command.salesReturnInspectionId}:${destination.status}`,
      },
    );
  }
  await transaction.inventoryMovement.createMany({ data: movements });
}

export async function postSalesInvoiceOutflowInventory(
  transaction: Prisma.TransactionClient,
  commands: readonly SalesInvoiceInventoryCommand[],
) {
  if (!commands.length)
    throw new InventoryRepositoryError("reference", "Invoice has no dispatch allocations.");
  const warehouseId = commands[0]!.warehouseId;
  if (commands.some((command) => command.warehouseId !== warehouseId))
    throw new InventoryRepositoryError(
      "reference",
      "An invoice uses one source warehouse per dispatch allocation.",
    );
  const requiredByAllocation = new Map<
    string,
    { itemId: string; productionLotId: string; quantity: Decimal }
  >();
  for (const command of commands) {
    const quantity = new Decimal(exactPositive(command.quantity, "Invoice quantity"));
    const current = requiredByAllocation.get(command.salesDispatchAllocationId);
    requiredByAllocation.set(command.salesDispatchAllocationId, {
      itemId: command.itemId,
      productionLotId: command.productionLotId,
      quantity: (current?.quantity ?? new Decimal(0)).add(quantity),
    });
  }
  for (const [salesDispatchAllocationId, required] of requiredByAllocation) {
    const inTransit = await transaction.inventoryMovement.aggregate({
      where: {
        warehouseId,
        itemId: required.itemId,
        productionLotId: required.productionLotId,
        salesDispatchAllocationId,
        status: "IN_TRANSIT",
      },
      _sum: { quantity: true },
    });
    if (new Decimal(inTransit._sum.quantity?.toString() ?? "0").lt(required.quantity))
      throw new InventoryRepositoryError(
        "stock",
        "A linked dispatch allocation no longer has enough IN_TRANSIT stock to invoice.",
      );
  }
  const groupId = randomUUID();
  await transaction.inventoryMovement.createMany({
    data: commands.map((command) => ({
      itemId: command.itemId,
      warehouseId: command.warehouseId,
      status: "IN_TRANSIT" as const,
      quantity: new Decimal(command.quantity).negated().toFixed(),
      canonicalUnitId: command.canonicalUnitId,
      movementType: "SALES_INVOICE_OUT" as const,
      referenceType: "SALES_INVOICE",
      referenceId: command.salesInvoiceId,
      sourceKey: `INV:${command.salesInvoiceAllocationId}:IN_TRANSIT`,
      groupId,
      reason: `Sales invoice ${command.salesInvoiceNumber} finalized dispatched stock outside company custody.`,
      createdByUserId: command.actorUserId,
      productionLotId: command.productionLotId,
      salesOrderId: command.salesOrderId,
      salesOrderLineId: command.salesOrderLineId,
      salesDispatchId: command.salesDispatchId,
      salesDispatchLineId: command.salesDispatchLineId,
      salesDispatchAllocationId: command.salesDispatchAllocationId,
      salesInvoiceId: command.salesInvoiceId,
      salesInvoiceLineId: command.salesInvoiceLineId,
      salesInvoiceAllocationId: command.salesInvoiceAllocationId,
    })),
  });
}

export async function postSalesDispatchInventory(
  transaction: Prisma.TransactionClient,
  commands: readonly SalesDispatchInventoryCommand[],
) {
  if (!commands.length)
    throw new InventoryRepositoryError("reference", "Dispatch has no lot allocations.");
  const warehouseId = commands[0]!.warehouseId;
  if (commands.some((command) => command.warehouseId !== warehouseId))
    throw new InventoryRepositoryError("reference", "A dispatch uses one source warehouse.");
  const itemIds = [...new Set(commands.map((command) => command.itemId))];
  const lotIds = [...new Set(commands.map((command) => command.productionLotId))];
  const [warehouse, items, lots] = await Promise.all([
    transaction.warehouse.findFirst({ where: { id: warehouseId, active: true } }),
    transaction.item.findMany({
      where: { id: { in: itemIds }, itemType: "FINISHED_GOOD", active: true },
      include: { stockUnit: true, finishedGoodProfile: true },
    }),
    transaction.productionLot.findMany({ where: { id: { in: lotIds } } }),
  ]);
  if (!warehouse || items.length !== itemIds.length || lots.length !== lotIds.length)
    throw new InventoryRepositoryError(
      "reference",
      "Dispatch warehouse, item, or production lot is invalid.",
    );
  const requiredByOrderLine = new Map<string, Decimal>();
  const requiredByLot = new Map<string, { itemId: string; quantity: Decimal }>();
  for (const command of commands) {
    const quantity = new Decimal(exactPositive(command.quantity, "Dispatch quantity"));
    const item = items.find((candidate) => candidate.id === command.itemId);
    const lot = lots.find((candidate) => candidate.id === command.productionLotId);
    if (
      !item ||
      !lot ||
      !item.finishedGoodProfile ||
      !isCanonicalPieceUnit(item.stockUnit) ||
      item.stockUnitId !== command.canonicalUnitId ||
      lot.finishedGoodId !== command.itemId ||
      (lot.expiryDate && lot.expiryDate < command.dispatchAt)
    )
      throw new InventoryRepositoryError(
        "reference",
        "Dispatch lot is incompatible, inactive, or expired for the dispatch date.",
      );
    requiredByOrderLine.set(
      command.salesOrderLineId,
      (requiredByOrderLine.get(command.salesOrderLineId) ?? new Decimal(0)).add(quantity),
    );
    const requiredLot = requiredByLot.get(lot.id);
    requiredByLot.set(lot.id, {
      itemId: command.itemId,
      quantity: (requiredLot?.quantity ?? new Decimal(0)).add(quantity),
    });
  }
  for (const [productionLotId, required] of requiredByLot) {
    const available = await transaction.inventoryMovement.aggregate({
      where: { itemId: required.itemId, warehouseId, productionLotId, status: "AVAILABLE" },
      _sum: { quantity: true },
    });
    if (new Decimal(available._sum.quantity?.toString() ?? "0").lt(required.quantity))
      throw new InventoryRepositoryError(
        "stock",
        "A selected production lot no longer has enough eligible stock.",
      );
  }
  for (const [salesOrderLineId, required] of requiredByOrderLine) {
    const reserved = await transaction.inventoryMovement.aggregate({
      where: { salesOrderLineId, warehouseId, status: "RESERVED" },
      _sum: { quantity: true },
    });
    if (new Decimal(reserved._sum.quantity?.toString() ?? "0").lt(required))
      throw new InventoryRepositoryError(
        "stock",
        "This sales-order line no longer has enough reserved stock for the dispatch.",
      );
  }
  const groupId = randomUUID();
  await transaction.inventoryMovement.createMany({
    data: commands.flatMap((command) => [
      {
        itemId: command.itemId,
        warehouseId,
        status: "RESERVED",
        quantity: new Decimal(command.quantity).negated().toFixed(),
        canonicalUnitId: command.canonicalUnitId,
        movementType: "SALES_DISPATCH",
        referenceType: "SALES_DISPATCH",
        referenceId: command.salesDispatchId,
        sourceKey: `DN:${command.salesDispatchAllocationId}:RESERVED`,
        groupId,
        reason: `Dispatch ${command.salesDispatchNumber} left warehouse custody.`,
        createdByUserId: command.actorUserId,
        productionLotId: command.productionLotId,
        salesOrderId: command.salesOrderId,
        salesOrderLineId: command.salesOrderLineId,
        salesDispatchId: command.salesDispatchId,
        salesDispatchLineId: command.salesDispatchLineId,
        salesDispatchAllocationId: command.salesDispatchAllocationId,
      },
      {
        itemId: command.itemId,
        warehouseId,
        status: "IN_TRANSIT",
        quantity: new Decimal(command.quantity).toFixed(),
        canonicalUnitId: command.canonicalUnitId,
        movementType: "SALES_DISPATCH",
        referenceType: "SALES_DISPATCH",
        referenceId: command.salesDispatchId,
        sourceKey: `DN:${command.salesDispatchAllocationId}:IN_TRANSIT`,
        groupId,
        reason: `Dispatch ${command.salesDispatchNumber} is in transit.`,
        createdByUserId: command.actorUserId,
        productionLotId: command.productionLotId,
        salesOrderId: command.salesOrderId,
        salesOrderLineId: command.salesOrderLineId,
        salesDispatchId: command.salesDispatchId,
        salesDispatchLineId: command.salesDispatchLineId,
        salesDispatchAllocationId: command.salesDispatchAllocationId,
      },
    ]),
  });
}

export async function postSalesOrderReservationInventory(
  transaction: Prisma.TransactionClient,
  commands: readonly SalesOrderReservationInventoryCommand[],
) {
  if (!commands.length)
    throw new InventoryRepositoryError("reference", "Sales order has no reservation lines.");
  const operation = commands[0]?.operation;
  if (!operation || commands.some((command) => command.operation !== operation))
    throw new InventoryRepositoryError("reference", "Reservation operation is inconsistent.");
  const itemIds = [...new Set(commands.map((command) => command.itemId))];
  const warehouseId = commands[0]!.warehouseId;
  if (commands.some((command) => command.warehouseId !== warehouseId))
    throw new InventoryRepositoryError(
      "reference",
      "A sales-order reservation uses one warehouse.",
    );
  const [items, warehouse] = await Promise.all([
    transaction.item.findMany({
      where: {
        id: { in: itemIds },
        itemType: "FINISHED_GOOD",
        ...(operation === "RESERVE" ? { active: true } : {}),
      },
      include: { stockUnit: true, finishedGoodProfile: true },
    }),
    transaction.warehouse.findFirst({
      where: { id: warehouseId, ...(operation === "RESERVE" ? { active: true } : {}) },
    }),
  ]);
  if (!warehouse || items.length !== itemIds.length)
    throw new InventoryRepositoryError(
      "reference",
      "Sales-order item or warehouse is inactive or invalid.",
    );
  const requiredByItem = new Map<string, Decimal>();
  for (const command of commands) {
    const quantity = new Decimal(exactPositive(command.quantity, "Reserved piece quantity"));
    const item = items.find((candidate) => candidate.id === command.itemId);
    if (
      !item ||
      !item.finishedGoodProfile ||
      item.stockUnitId !== command.canonicalUnitId ||
      !isSupportedQuantityUnitCode(item.stockUnit.code) ||
      item.stockUnit.dimension !== "COUNT"
    )
      throw new InventoryRepositoryError(
        "reference",
        "Sales-order item must be a finished good with a canonical piece unit.",
      );
    requiredByItem.set(
      command.itemId,
      (requiredByItem.get(command.itemId) ?? new Decimal(0)).add(quantity),
    );
  }
  const sourceStatus = operation === "RESERVE" ? "AVAILABLE" : "RESERVED";
  for (const [itemId, required] of requiredByItem) {
    const balance = await transaction.inventoryMovement.aggregate({
      where: { itemId, warehouseId, status: sourceStatus },
      _sum: { quantity: true },
    });
    const available = new Decimal(balance._sum.quantity?.toString() ?? "0");
    if (available.lt(required))
      throw new InventoryRepositoryError(
        "stock",
        operation === "RESERVE"
          ? `Insufficient AVAILABLE stock for a sales-order line; short ${required.sub(available).toFixed()} pieces.`
          : "The sales-order reservation is no longer available to release.",
      );
  }
  const groupId = randomUUID();
  const movementType: InventoryMovementType =
    operation === "RESERVE" ? "SALES_RESERVATION" : "SALES_RESERVATION_RELEASE";
  const destinationStatus = operation === "RESERVE" ? "RESERVED" : "AVAILABLE";
  await transaction.inventoryMovement.createMany({
    data: commands.flatMap((command) => {
      const quantity = new Decimal(command.quantity).toFixed();
      const prefix = `SO:${command.salesOrderLineId}:${operation}`;
      const common = {
        itemId: command.itemId,
        warehouseId: command.warehouseId,
        canonicalUnitId: command.canonicalUnitId,
        movementType,
        referenceType: "SALES_ORDER",
        referenceId: command.salesOrderId,
        groupId,
        salesOrderId: command.salesOrderId,
        salesOrderLineId: command.salesOrderLineId,
        reason:
          operation === "RESERVE"
            ? `Sales order ${command.salesOrderNumber} stock reservation.`
            : `Sales order ${command.salesOrderNumber} reservation release.`,
        createdByUserId: command.actorUserId,
      };
      return [
        {
          ...common,
          status: sourceStatus,
          quantity: new Decimal(quantity).negated().toFixed(),
          sourceKey: `${prefix}:${sourceStatus}`,
        },
        {
          ...common,
          status: destinationStatus,
          quantity,
          sourceKey: `${prefix}:${destinationStatus}`,
        },
      ];
    }),
  });
}

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
