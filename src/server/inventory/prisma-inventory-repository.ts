import "server-only";

import { randomUUID } from "node:crypto";

import Decimal from "decimal.js";

import { Prisma } from "@/generated/prisma/client";
import type {
  InventoryItemOption,
  InventoryLotOption,
  InventoryRepository,
  InventoryUnitOption,
  MovementHistoryQuery,
  PageResult,
  SinglePostingCommand,
  StatusTransferCommand,
  StockOverviewRecord,
  WarehouseInput,
  WarehouseRecord,
  WarehouseTransferCommand,
} from "@/modules/inventory/application/contracts";
import { InventoryRepositoryError } from "@/modules/inventory/application/contracts";
import {
  INVENTORY_PAGE_SIZE,
  movementSign,
  type ImplementedMovementType,
  type InventoryStatus,
} from "@/modules/inventory/domain/inventory";
import { normalizeCartonQuantity } from "@/modules/quantity/domain/cartons";
import {
  isCanonicalPieceUnit,
  isSupportedQuantityUnitCode,
  normalizeQuantity,
  supportedQuantityUnitDimension,
} from "@/modules/quantity/domain/quantity";
import { prisma } from "@/server/db/prisma";
import { valueManualInventoryMovement } from "@/server/costing/prisma-inventory-valuation-repository";
import { recordAuditEvent } from "@/server/audit/audit-event";

export class PrismaInventoryRepository implements InventoryRepository {
  async listWarehouses(query: string, page: number): Promise<PageResult<WarehouseRecord>> {
    const where = query.trim()
      ? {
          OR: [
            { code: { contains: query.trim(), mode: "insensitive" as const } },
            { name: { contains: query.trim(), mode: "insensitive" as const } },
          ],
        }
      : {};
    const [total, records] = await prisma.$transaction([
      prisma.warehouse.count({ where }),
      prisma.warehouse.findMany({
        where,
        orderBy: [{ active: "desc" }, { name: "asc" }],
        skip: (page - 1) * INVENTORY_PAGE_SIZE,
        take: INVENTORY_PAGE_SIZE,
      }),
    ]);
    return paged(records, page, total);
  }

  async listActiveWarehouses() {
    return prisma.warehouse.findMany({
      where: { active: true },
      orderBy: { name: "asc" },
      take: 250,
    });
  }

  async saveWarehouse(input: Omit<WarehouseInput, "id"> & { id?: string | undefined }) {
    try {
      if (input.id) {
        return (
          await prisma.warehouse.update({
            where: { id: input.id },
            data: { code: input.code, name: input.name, description: input.description ?? null },
          })
        ).id;
      }
      return (
        await prisma.warehouse.create({
          data: { code: input.code, name: input.name, description: input.description ?? null },
        })
      ).id;
    } catch (error) {
      throw mapError(error, "warehouse");
    }
  }

  async setWarehouseActive(id: string, active: boolean) {
    return serializable(async (transaction) => {
      if (!active) {
        const groups = await transaction.inventoryMovement.groupBy({
          by: ["itemId", "status"],
          where: { warehouseId: id },
          _sum: { quantity: true },
        });
        if (groups.some((group) => !new Decimal(group._sum.quantity?.toString() ?? "0").isZero())) {
          throw new InventoryRepositoryError(
            "stock",
            "Move all remaining inventory before deactivating this warehouse.",
          );
        }
      }
      return (
        (await transaction.warehouse.updateMany({ where: { id }, data: { active } })).count === 1
      );
    });
  }

  async listPostingItems(): Promise<readonly InventoryItemOption[]> {
    const rows = await prisma.item.findMany({
      where: { active: true },
      include: { stockUnit: true, finishedGoodProfile: true },
      orderBy: [{ itemType: "asc" }, { name: "asc" }],
      take: 500,
    });
    return rows
      .filter(
        (row) =>
          row.stockUnit.active &&
          isSupportedQuantityUnitCode(row.stockUnit.code) &&
          supportedQuantityUnitDimension(row.stockUnit.code) === row.stockUnit.dimension &&
          (row.itemType !== "FINISHED_GOOD" ||
            (isCanonicalPieceUnit(row.stockUnit) && row.finishedGoodProfile !== null)),
      )
      .map((row) => ({
        id: row.id,
        code: row.code,
        name: row.name,
        itemType: row.itemType,
        stockUnitDimension: row.stockUnit.dimension,
        piecesPerCarton: row.finishedGoodProfile?.piecesPerCarton ?? null,
      }));
  }

  async listLotBalances(): Promise<readonly InventoryLotOption[]> {
    const groups = await prisma.inventoryMovement.groupBy({
      by: [
        "itemId",
        "warehouseId",
        "status",
        "inventoryLotId",
        "productionLotId",
        "canonicalUnitId",
      ],
      where: { OR: [{ inventoryLotId: { not: null } }, { productionLotId: { not: null } }] },
      _sum: { quantity: true },
    });
    const positive = groups.filter((group) =>
      new Decimal(group._sum.quantity?.toString() ?? "0").gt(0),
    );
    const [inventoryLots, productionLots, units] = await Promise.all([
      prisma.inventoryLot.findMany({
        where: { id: { in: positive.flatMap((group) => group.inventoryLotId ?? []) } },
        include: { sourceGoodsReceipt: { select: { number: true } } },
      }),
      prisma.productionLot.findMany({
        where: { id: { in: positive.flatMap((group) => group.productionLotId ?? []) } },
      }),
      prisma.unit.findMany({
        where: { id: { in: positive.map((group) => group.canonicalUnitId) } },
      }),
    ]);
    return positive.flatMap((group) => {
      const unit = units.find((candidate) => candidate.id === group.canonicalUnitId)?.symbol ?? "";
      const quantity = new Decimal(group._sum.quantity?.toString() ?? "0").toFixed();
      if (group.inventoryLotId) {
        const lot = inventoryLots.find((candidate) => candidate.id === group.inventoryLotId);
        if (!lot) return [];
        return [
          {
            value: `inv:${lot.id}`,
            label: `${lot.supplierLotNumber ?? lot.sourceGoodsReceipt.number} (${quantity} ${unit})`,
            itemId: group.itemId,
            warehouseId: group.warehouseId,
            status: group.status,
            quantity,
          },
        ];
      }
      const lot = productionLots.find((candidate) => candidate.id === group.productionLotId);
      if (!lot) return [];
      return [
        {
          value: `prod:${lot.id}`,
          label: `${lot.lotNumber} (${quantity} ${unit})`,
          itemId: group.itemId,
          warehouseId: group.warehouseId,
          status: group.status,
          quantity,
        },
      ];
    });
  }

  async listPostingUnits(): Promise<readonly InventoryUnitOption[]> {
    const rows = await prisma.unit.findMany({ where: { active: true }, orderBy: { name: "asc" } });
    return rows.filter(
      (row) =>
        isSupportedQuantityUnitCode(row.code) &&
        supportedQuantityUnitDimension(row.code) === row.dimension,
    );
  }

  async postSingle(command: SinglePostingCommand) {
    return serializable(async (transaction) => {
      const context = await postingContext(transaction, command.itemId, [command.warehouseId]);
      const normalized = await normalizePosting(transaction, context.item, command);
      const sign = movementSign(command.movementType);
      if (sign < 0) {
        await requireSufficient(
          transaction,
          command.itemId,
          command.warehouseId,
          command.status,
          normalized.amount,
        );
      }
      const allocations = await allocateLots(transaction, {
        itemId: command.itemId,
        warehouseId: command.warehouseId,
        status: command.status,
        lotRef: command.lotRef,
        outbound: sign < 0,
        amount: normalized.amount,
      });
      let movement: { id: string } | undefined;
      for (const [index, allocation] of allocations.entries()) {
        const created = await transaction.inventoryMovement.create({
          data: {
            ...movementData({
              command: { ...command, ...splitSourceKey(command.sourceKey, index) },
              warehouseId: command.warehouseId,
              quantity: signed(allocation.amount, sign),
              canonicalUnitId: normalized.unitId,
            }),
            ...allocation.columns,
          },
        });
        movement ??= created;
        await valueManualInventoryMovement(
          transaction,
          created.id,
          command.unitCost,
          command.actorUserId,
        );
      }
      if (!movement)
        throw new InventoryRepositoryError("reference", "Nothing to post for this adjustment.");
      await recordAuditEvent(transaction, {
        actorUserId: command.actorUserId,
        action: "ADJUST",
        entityType: "INVENTORY_ADJUSTMENT",
        entityId: movement.id,
        entityReference: command.referenceId ?? movement.id,
        module: "inventory",
        description: `Posted ${command.movementType.toLowerCase().replaceAll("_", " ")} inventory adjustment.`,
        reasonCode: "OPERATIONAL_CORRECTION",
        reason: command.reason,
        metadata: {
          itemId: command.itemId,
          warehouseId: command.warehouseId,
          status: command.status,
          quantity: signed(normalized.amount, sign),
          canonicalUnitId: normalized.unitId,
          referenceType: command.referenceType,
        },
        controlEvent: true,
      });
      return movement.id;
    });
  }

  async transferWarehouse(command: WarehouseTransferCommand) {
    if (command.sourceWarehouseId === command.destinationWarehouseId) {
      throw new InventoryRepositoryError("reference", "Warehouses must be different.");
    }
    return serializable(async (transaction) => {
      const context = await postingContext(transaction, command.itemId, [
        command.sourceWarehouseId,
        command.destinationWarehouseId,
      ]);
      const normalized = await normalizePosting(transaction, context.item, command);
      await requireSufficient(
        transaction,
        command.itemId,
        command.sourceWarehouseId,
        command.status,
        normalized.amount,
      );
      const allocations = await allocateLots(transaction, {
        itemId: command.itemId,
        warehouseId: command.sourceWarehouseId,
        status: command.status,
        lotRef: command.lotRef,
        outbound: true,
        amount: normalized.amount,
      });
      const groupId = randomUUID();
      await transaction.inventoryMovement.createMany({
        data: allocations.flatMap((allocation, index) => [
          {
            ...movementData({
              command: {
                ...command,
                ...splitSourceKey(command.sourceKey, index),
                movementType: "TRANSFER_OUT",
                referenceType: "WAREHOUSE_TRANSFER",
              },
              warehouseId: command.sourceWarehouseId,
              quantity: signed(allocation.amount, -1),
              canonicalUnitId: normalized.unitId,
              groupId,
            }),
            ...allocation.columns,
          },
          {
            ...movementData({
              command: {
                ...command,
                ...splitSourceKey(command.sourceKey, index),
                movementType: "TRANSFER_IN",
                referenceType: "WAREHOUSE_TRANSFER",
              },
              warehouseId: command.destinationWarehouseId,
              quantity: signed(allocation.amount, 1),
              canonicalUnitId: normalized.unitId,
              groupId,
            }),
            ...allocation.columns,
          },
        ]),
      });
      await recordAuditEvent(transaction, {
        actorUserId: command.actorUserId,
        action: "POST",
        entityType: "INVENTORY_TRANSFER",
        entityId: groupId,
        entityReference: command.referenceId ?? groupId,
        module: "inventory",
        description: "Posted warehouse inventory transfer.",
        metadata: {
          itemId: command.itemId,
          sourceWarehouseId: command.sourceWarehouseId,
          destinationWarehouseId: command.destinationWarehouseId,
          status: command.status,
          quantity: normalized.amount,
          canonicalUnitId: normalized.unitId,
        },
        reasonCode: "OPERATIONAL_CORRECTION",
        reason: command.reason,
        controlEvent: true,
      });
      return groupId;
    });
  }

  async moveStatus(command: StatusTransferCommand) {
    if (command.sourceStatus === command.destinationStatus) {
      throw new InventoryRepositoryError("reference", "Statuses must be different.");
    }
    return serializable(async (transaction) => {
      const context = await postingContext(transaction, command.itemId, [command.warehouseId]);
      const normalized = await normalizePosting(transaction, context.item, command);
      await requireSufficient(
        transaction,
        command.itemId,
        command.warehouseId,
        command.sourceStatus,
        normalized.amount,
      );
      const groupId = randomUUID();
      await transaction.inventoryMovement.createMany({
        data: [
          movementData({
            command: { ...command, movementType: "STATUS_OUT", referenceType: "STATUS_TRANSFER" },
            warehouseId: command.warehouseId,
            status: command.sourceStatus,
            quantity: signed(normalized.amount, -1),
            canonicalUnitId: normalized.unitId,
            groupId,
          }),
          movementData({
            command: { ...command, movementType: "STATUS_IN", referenceType: "STATUS_TRANSFER" },
            warehouseId: command.warehouseId,
            status: command.destinationStatus,
            quantity: signed(normalized.amount, 1),
            canonicalUnitId: normalized.unitId,
            groupId,
          }),
        ],
      });
      await recordAuditEvent(transaction, {
        actorUserId: command.actorUserId,
        action: "ADJUST",
        entityType: "INVENTORY_TRANSFER",
        entityId: groupId,
        entityReference: command.referenceId ?? groupId,
        module: "inventory",
        description: "Posted inventory status transfer.",
        metadata: {
          itemId: command.itemId,
          warehouseId: command.warehouseId,
          sourceStatus: command.sourceStatus,
          destinationStatus: command.destinationStatus,
          quantity: normalized.amount,
          canonicalUnitId: normalized.unitId,
        },
        reasonCode: "OPERATIONAL_CORRECTION",
        reason: command.reason,
        controlEvent: true,
      });
      return groupId;
    });
  }

  async getStockBalance(itemId: string, warehouseId: string, status: InventoryStatus) {
    return balance(prisma, itemId, warehouseId, status);
  }

  async getAvailableQuantity(itemId: string, warehouseId: string) {
    return this.getStockBalance(itemId, warehouseId, "AVAILABLE");
  }

  async listMovementHistory(query: MovementHistoryQuery) {
    const where = {
      ...(query.query
        ? {
            item: {
              OR: [
                { code: { contains: query.query, mode: "insensitive" as const } },
                { name: { contains: query.query, mode: "insensitive" as const } },
              ],
            },
          }
        : {}),
      ...(query.warehouseId ? { warehouseId: query.warehouseId } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.movementType ? { movementType: query.movementType } : {}),
      ...(query.dateFrom || query.dateTo
        ? {
            postedAt: {
              ...(query.dateFrom ? { gte: query.dateFrom } : {}),
              ...(query.dateTo ? { lt: query.dateTo } : {}),
            },
          }
        : {}),
    };
    const [total, rows] = await prisma.$transaction([
      prisma.inventoryMovement.count({ where }),
      prisma.inventoryMovement.findMany({
        where,
        include: {
          item: { include: { finishedGoodProfile: true } },
          warehouse: true,
          canonicalUnit: true,
          createdBy: true,
          inventoryLot: true,
        },
        orderBy: [{ postedAt: "desc" }, { id: "desc" }],
        skip: (query.page - 1) * INVENTORY_PAGE_SIZE,
        take: INVENTORY_PAGE_SIZE,
      }),
    ]);
    return paged(
      rows.map((row) => ({
        id: row.id,
        postedAt: row.postedAt,
        itemCode: row.item.code,
        itemName: row.item.name,
        itemType: row.item.itemType,
        warehouseName: row.warehouse.name,
        status: row.status,
        movementType: row.movementType,
        quantity: row.quantity.toString(),
        canonicalUnitCode: row.canonicalUnit.code,
        canonicalUnitSymbol: row.canonicalUnit.symbol,
        canonicalUnitDimension: row.canonicalUnit.dimension,
        referenceType: row.referenceType,
        referenceId: row.referenceId,
        groupId: row.groupId,
        userName: row.createdBy.name,
        reason: row.reason,
        supplierLotNumber: row.inventoryLot?.supplierLotNumber ?? null,
        piecesPerCarton: row.item.finishedGoodProfile?.piecesPerCarton ?? null,
      })),
      query.page,
      total,
    );
  }

  async listStockOverview(query: string, page: number): Promise<PageResult<StockOverviewRecord>> {
    const groups = await prisma.inventoryMovement.groupBy({
      by: ["itemId", "warehouseId", "status", "canonicalUnitId"],
      ...(query
        ? {
            where: {
              item: {
                OR: [
                  { code: { contains: query, mode: "insensitive" as const } },
                  { name: { contains: query, mode: "insensitive" as const } },
                ],
              },
            },
          }
        : {}),
      _sum: { quantity: true },
      orderBy: [{ itemId: "asc" }, { warehouseId: "asc" }],
    });
    const nonzero = groups.filter(
      (group) => !new Decimal(group._sum?.quantity?.toString() ?? "0").isZero(),
    );
    const keys = [
      ...new Set(
        nonzero.map((group) => `${group.itemId}:${group.warehouseId}:${group.canonicalUnitId}`),
      ),
    ];
    const total = keys.length;
    const pageKeys = new Set(
      keys.slice((page - 1) * INVENTORY_PAGE_SIZE, page * INVENTORY_PAGE_SIZE),
    );
    const selected = nonzero.filter((group) =>
      pageKeys.has(`${group.itemId}:${group.warehouseId}:${group.canonicalUnitId}`),
    );
    const itemIds = [...new Set(selected.map((group) => group.itemId))];
    const warehouseIds = [...new Set(selected.map((group) => group.warehouseId))];
    const unitIds = [...new Set(selected.map((group) => group.canonicalUnitId))];
    const [items, warehouses, units] = await Promise.all([
      prisma.item.findMany({
        where: { id: { in: itemIds } },
        include: { finishedGoodProfile: true },
      }),
      prisma.warehouse.findMany({ where: { id: { in: warehouseIds } } }),
      prisma.unit.findMany({ where: { id: { in: unitIds } } }),
    ]);
    const records = [...pageKeys].map((key) => {
      const [itemId, warehouseId, canonicalUnitId] = key.split(":") as [string, string, string];
      const item = items.find((row) => row.id === itemId)!;
      const warehouse = warehouses.find((row) => row.id === warehouseId)!;
      const rows = selected.filter(
        (row) =>
          row.itemId === itemId &&
          row.warehouseId === warehouseId &&
          row.canonicalUnitId === canonicalUnitId,
      );
      const unit = units.find((row) => row.id === rows[0]!.canonicalUnitId)!;
      const available = sumRows(rows.filter((row) => row.status === "AVAILABLE"));
      const totalQuantity = sumRows(rows);
      return {
        itemId,
        itemCode: item.code,
        itemName: item.name,
        itemType: item.itemType,
        warehouseId,
        warehouseName: warehouse.name,
        availableQuantity: available,
        otherStatusQuantity: new Decimal(totalQuantity).sub(available).toFixed(),
        totalQuantity,
        canonicalUnitCode: unit.code,
        canonicalUnitSymbol: unit.symbol,
        canonicalUnitDimension: unit.dimension,
        piecesPerCarton:
          unit.dimension === "COUNT" ? (item.finishedGoodProfile?.piecesPerCarton ?? null) : null,
      };
    });
    return paged(records, page, total);
  }
}

async function postingContext(
  transaction: Prisma.TransactionClient,
  itemId: string,
  warehouseIds: string[],
) {
  const [item, warehouseCount] = await Promise.all([
    transaction.item.findFirst({
      where: { id: itemId, active: true },
      include: { stockUnit: true, finishedGoodProfile: true },
    }),
    transaction.warehouse.count({ where: { id: { in: warehouseIds }, active: true } }),
  ]);
  if (!item || warehouseCount !== new Set(warehouseIds).size) {
    throw new InventoryRepositoryError("reference", "Select an active item and warehouse.");
  }
  if (
    !item.stockUnit.active ||
    !isSupportedQuantityUnitCode(item.stockUnit.code) ||
    supportedQuantityUnitDimension(item.stockUnit.code) !== item.stockUnit.dimension ||
    (item.itemType === "FINISHED_GOOD" &&
      (!isCanonicalPieceUnit(item.stockUnit) || !item.finishedGoodProfile))
  ) {
    throw new InventoryRepositoryError(
      "reference",
      "The item's canonical stock configuration is not valid for inventory posting.",
    );
  }
  return { item };
}

async function normalizePosting(
  transaction: Prisma.TransactionClient,
  item: Awaited<ReturnType<typeof postingContext>>["item"],
  input: { quantity?: string; unitId?: string; cartons?: string; loosePieces?: string },
) {
  const units = await transaction.unit.findMany({ where: { active: true } });
  const supported = units.filter(
    (unit) =>
      isSupportedQuantityUnitCode(unit.code) &&
      supportedQuantityUnitDimension(unit.code) === unit.dimension,
  );
  let amount: string;
  let unit: (typeof supported)[number] | undefined;
  const usesCartons = item.itemType === "FINISHED_GOOD" && (input.cartons || input.loosePieces);
  if (usesCartons) {
    if (!item.finishedGoodProfile)
      throw new InventoryRepositoryError("reference", "Finished-good profile is invalid.");
    const breakdown = normalizeCartonQuantity(
      input.cartons || "0",
      input.loosePieces || "0",
      item.finishedGoodProfile.piecesPerCarton,
    );
    amount = breakdown.totalPieces;
    unit = supported.find(
      (candidate) => candidate.code === "PCS" && candidate.dimension === "COUNT",
    );
  } else {
    const selected = supported.find((candidate) => candidate.id === input.unitId);
    if (!selected || !input.quantity || selected.dimension !== item.stockUnit.dimension) {
      throw new InventoryRepositoryError("reference", "Select a compatible active quantity unit.");
    }
    const normalized = normalizeQuantity({ amount: input.quantity, unit: selected }, supported);
    amount = normalized.amount;
    unit = supported.find((candidate) => candidate.code === normalized.unit.code);
  }
  const exact = new Decimal(amount);
  if (!unit || exact.lte(0) || exact.decimalPlaces() > 6 || exact.gt("999999999999999999.999999")) {
    throw new InventoryRepositoryError(
      "reference",
      "Quantity is outside the supported canonical range.",
    );
  }
  return { amount: exact.toFixed(), unitId: unit.id };
}

async function requireSufficient(
  transaction: Prisma.TransactionClient,
  itemId: string,
  warehouseId: string,
  status: InventoryStatus,
  required: string,
) {
  const current = new Decimal(await balance(transaction, itemId, warehouseId, status));
  if (current.lt(required)) {
    throw new InventoryRepositoryError(
      "stock",
      `Insufficient ${status.toLowerCase().replaceAll("_", " ")} inventory.`,
    );
  }
}

async function balance(
  client: Prisma.TransactionClient | typeof prisma,
  itemId: string,
  warehouseId: string,
  status: InventoryStatus,
) {
  const result = await client.inventoryMovement.aggregate({
    where: { itemId, warehouseId, status },
    _sum: { quantity: true },
  });
  return result._sum.quantity?.toString() ?? "0";
}

function movementData(input: {
  command: {
    itemId: string;
    status?: InventoryStatus;
    movementType: ImplementedMovementType;
    referenceType: string;
    referenceId?: string;
    sourceKey?: string;
    reason: string;
    actorUserId: string;
  };
  warehouseId: string;
  status?: InventoryStatus;
  quantity: string;
  canonicalUnitId: string;
  groupId?: string;
}) {
  return {
    itemId: input.command.itemId,
    warehouseId: input.warehouseId,
    status: input.status ?? input.command.status!,
    quantity: input.quantity,
    canonicalUnitId: input.canonicalUnitId,
    movementType: input.command.movementType,
    referenceType: input.command.referenceType,
    referenceId: input.command.referenceId ?? null,
    sourceKey: input.command.sourceKey ?? null,
    groupId: input.groupId ?? null,
    reason: input.command.reason,
    createdByUserId: input.command.actorUserId,
  };
}

function signed(amount: string, sign: 1 | -1) {
  return new Decimal(amount).mul(sign).toFixed();
}

function sumRows(
  rows: readonly { _sum?: { quantity?: { toString(): string } | null } | undefined }[],
) {
  return rows
    .reduce((total, row) => total.add(row._sum?.quantity?.toString() ?? "0"), new Decimal(0))
    .toFixed();
}

function paged<T>(records: readonly T[], page: number, total: number): PageResult<T> {
  return { records, page, total, pageCount: Math.max(1, Math.ceil(total / INVENTORY_PAGE_SIZE)) };
}

async function serializable<T>(operation: (transaction: Prisma.TransactionClient) => Promise<T>) {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await prisma.$transaction(operation, { isolationLevel: "Serializable" });
    } catch (error) {
      const retryable =
        error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034";
      if (!retryable || attempt === 3) throw mapError(error, "inventory movement");
    }
  }
  throw new InventoryRepositoryError("conflict", "Inventory posting conflict; retry.");
}

function mapError(error: unknown, entity: string) {
  if (error instanceof InventoryRepositoryError) return error;
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
    return new InventoryRepositoryError("conflict", `This ${entity} reference was already posted.`);
  }
  return new InventoryRepositoryError("conflict", `${entity} could not be saved.`);
}

type LotColumns = { inventoryLotId?: string; productionLotId?: string };
type LotAllocation = { columns: LotColumns; amount: string };

/** Split movements after the first get a suffixed import key (sourceKey is unique per type). */
function splitSourceKey(sourceKey: string | undefined, index: number) {
  return sourceKey && index > 0 ? { sourceKey: `${sourceKey}#${index + 1}` } : {};
}

/**
 * Manual adjustments and transfers must keep lot balances in step with item balances.
 * - A chosen lot is validated (belongs to the item, and holds enough stock when going out).
 * - Stock going out with no lot chosen is drawn from the lots in that bucket
 *   first-expiry-first-out (then oldest), and only then from stock that was never lot-tagged;
 *   one movement is written per lot so every lot balance stays correct.
 * - Stock coming in with no lot chosen stays untagged.
 */
async function allocateLots(
  transaction: Prisma.TransactionClient,
  input: {
    itemId: string;
    warehouseId: string;
    status: InventoryStatus;
    lotRef: string | undefined;
    outbound: boolean;
    amount: string;
  },
): Promise<LotAllocation[]> {
  if (input.lotRef) {
    const [kind, id] = input.lotRef.split(":") as ["inv" | "prod", string];
    const lot =
      kind === "inv"
        ? await transaction.inventoryLot.findUnique({ where: { id }, select: { itemId: true } })
        : await transaction.productionLot.findUnique({
            where: { id },
            select: { finishedGoodId: true },
          });
    const lotItemId = lot ? ("itemId" in lot ? lot.itemId : lot.finishedGoodId) : null;
    if (lotItemId !== input.itemId)
      throw new InventoryRepositoryError(
        "reference",
        "The selected lot does not belong to this item.",
      );
    const columns: LotColumns = kind === "inv" ? { inventoryLotId: id } : { productionLotId: id };
    if (input.outbound) {
      const balance = await transaction.inventoryMovement.aggregate({
        where: {
          itemId: input.itemId,
          warehouseId: input.warehouseId,
          status: input.status,
          ...columns,
        },
        _sum: { quantity: true },
      });
      if (new Decimal(balance._sum.quantity?.toString() ?? "0").lt(input.amount))
        throw new InventoryRepositoryError(
          "stock",
          "The selected lot does not hold enough stock in this warehouse and status.",
        );
    }
    return [{ columns, amount: input.amount }];
  }
  if (!input.outbound) return [{ columns: {}, amount: input.amount }];
  const groups = await transaction.inventoryMovement.groupBy({
    by: ["inventoryLotId", "productionLotId"],
    where: { itemId: input.itemId, warehouseId: input.warehouseId, status: input.status },
    _sum: { quantity: true },
  });
  const tagged = groups.filter(
    (group) =>
      (group.inventoryLotId || group.productionLotId) &&
      new Decimal(group._sum.quantity?.toString() ?? "0").gt(0),
  );
  if (!tagged.length) return [{ columns: {}, amount: input.amount }];
  const [inventoryLots, productionLots] = await Promise.all([
    transaction.inventoryLot.findMany({
      where: { id: { in: tagged.flatMap((group) => group.inventoryLotId ?? []) } },
      select: { id: true, expiryDate: true, createdAt: true },
    }),
    transaction.productionLot.findMany({
      where: { id: { in: tagged.flatMap((group) => group.productionLotId ?? []) } },
      select: { id: true, expiryDate: true, createdAt: true },
    }),
  ]);
  const ordered = tagged
    .map((group) => {
      const lot = group.inventoryLotId
        ? inventoryLots.find((candidate) => candidate.id === group.inventoryLotId)
        : productionLots.find((candidate) => candidate.id === group.productionLotId);
      const columns: LotColumns = group.inventoryLotId
        ? { inventoryLotId: group.inventoryLotId }
        : { productionLotId: group.productionLotId! };
      return {
        columns,
        available: new Decimal(group._sum.quantity?.toString() ?? "0"),
        expiry: lot?.expiryDate?.getTime() ?? Number.MAX_SAFE_INTEGER,
        created: lot?.createdAt.getTime() ?? 0,
      };
    })
    .sort((a, b) => a.expiry - b.expiry || a.created - b.created);
  let remaining = new Decimal(input.amount);
  const allocations: LotAllocation[] = [];
  for (const lot of ordered) {
    if (remaining.lte(0)) break;
    const take = Decimal.min(remaining, lot.available);
    allocations.push({ columns: lot.columns, amount: take.toFixed() });
    remaining = remaining.sub(take);
  }
  // Any remainder comes from stock that was never lot-tagged (sufficiency was checked already).
  if (remaining.gt(0)) allocations.push({ columns: {}, amount: remaining.toFixed() });
  return allocations;
}
