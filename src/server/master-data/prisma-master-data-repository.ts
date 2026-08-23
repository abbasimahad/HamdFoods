import "server-only";

import { Prisma } from "@/generated/prisma/client";
import type { MasterDataSeedStore } from "@/modules/master-data/application/seed-master-data";
import type {
  CategoryInput,
  CategoryRecord,
  ItemInput,
  ItemRecord,
  ListQuery,
  MasterDataRepository,
  PaginatedResult,
  UnitInput,
  UnitRecord,
} from "@/modules/master-data/application/contracts";
import { MasterDataRepositoryError } from "@/modules/master-data/application/contracts";
import type { ItemType, UnitDimension } from "@/modules/master-data/domain/master-data";
import {
  isCanonicalPieceUnit,
  isSupportedQuantityUnitCode,
  supportedQuantityUnitDimension,
} from "@/modules/quantity/domain/quantity";
import { prisma } from "@/server/db/prisma";

export class PrismaMasterDataRepository implements MasterDataRepository, MasterDataSeedStore {
  async listUnits(query: ListQuery): Promise<PaginatedResult<UnitRecord>> {
    const where = searchWhere(query.query);
    const [total, records] = await prisma.$transaction([
      prisma.unit.count({ where }),
      prisma.unit.findMany({
        where,
        orderBy: [{ active: "desc" }, { name: "asc" }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);
    return pageResult(records, query, total);
  }

  async listCategories(
    query: ListQuery,
    itemType?: ItemType,
  ): Promise<PaginatedResult<CategoryRecord>> {
    const where = { ...searchWhere(query.query), ...(itemType ? { itemType } : {}) };
    const [total, records] = await prisma.$transaction([
      prisma.itemCategory.count({ where }),
      prisma.itemCategory.findMany({
        where,
        orderBy: [{ active: "desc" }, { itemType: "asc" }, { name: "asc" }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);
    return pageResult(records, query, total);
  }

  async listItems(itemType: ItemType, query: ListQuery): Promise<PaginatedResult<ItemRecord>> {
    const where = { itemType, ...searchWhere(query.query) };
    const [total, rows] = await prisma.$transaction([
      prisma.item.count({ where }),
      prisma.item.findMany({
        where,
        orderBy: [{ active: "desc" }, { name: "asc" }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: {
          category: true,
          stockUnit: true,
          finishedGoodProfile: { include: { netContentUnit: true } },
        },
      }),
    ]);
    const records = rows.map((row) => ({
      id: row.id,
      code: row.code,
      name: row.name,
      itemType: row.itemType,
      categoryId: row.categoryId,
      categoryName: row.category.name,
      stockUnitId: row.stockUnitId,
      stockUnitSymbol: row.stockUnit.symbol,
      packagingKind: row.packagingKind,
      description: row.description,
      active: row.active,
      finishedGoodProfile: row.finishedGoodProfile
        ? {
            netContentQuantity: row.finishedGoodProfile.netContentQuantity.toString(),
            netContentUnitId: row.finishedGoodProfile.netContentUnitId,
            netContentUnitCode: row.finishedGoodProfile.netContentUnit.code,
            netContentUnitSymbol: row.finishedGoodProfile.netContentUnit.symbol,
            netContentUnitDimension: row.finishedGoodProfile.netContentUnitDimension,
            netContentUnitActive: row.finishedGoodProfile.netContentUnit.active,
            piecesPerCarton: row.finishedGoodProfile.piecesPerCarton,
          }
        : null,
    }));
    return pageResult(records, query, total);
  }

  async listActiveUnits(dimensions?: readonly UnitDimension[]) {
    return prisma.unit.findMany({
      where: {
        active: true,
        ...(dimensions ? { dimension: { in: [...dimensions] } } : {}),
      },
      orderBy: [{ dimension: "asc" }, { name: "asc" }],
      take: 250,
    });
  }

  async listActiveCategories(itemType: ItemType) {
    return prisma.itemCategory.findMany({
      where: { active: true, itemType },
      orderBy: { name: "asc" },
      take: 250,
    });
  }

  async getCategory(id: string) {
    return prisma.itemCategory.findUnique({ where: { id } });
  }

  async getUnit(id: string) {
    return prisma.unit.findUnique({ where: { id } });
  }

  async saveUnit(input: UnitInput) {
    try {
      const supportedDimension = supportedQuantityUnitDimension(input.code);
      if (supportedDimension && input.dimension !== supportedDimension) {
        throw new MasterDataRepositoryError(
          "invalid-reference",
          `${input.code} must retain its ${supportedDimension} dimension.`,
        );
      }
      if (input.id) {
        const current = await prisma.unit.findUnique({
          where: { id: input.id },
          select: {
            code: true,
            dimension: true,
            _count: { select: { stockItems: true, finishedGoodProfiles: true } },
          },
        });
        if (!current) {
          throw new MasterDataRepositoryError("not-found", "The unit no longer exists.");
        }
        if (
          isSupportedQuantityUnitCode(current.code) &&
          (input.code !== current.code || input.dimension !== current.dimension)
        ) {
          throw new MasterDataRepositoryError(
            "invalid-reference",
            "Supported conversion unit codes and dimensions cannot be changed.",
          );
        }
        if (
          current.dimension !== input.dimension &&
          current._count.stockItems + current._count.finishedGoodProfiles > 0
        ) {
          throw new MasterDataRepositoryError(
            "invalid-reference",
            "A unit already used by items cannot change dimension.",
          );
        }
        return (
          await prisma.unit.update({
            where: { id: input.id },
            data: {
              code: input.code,
              name: input.name,
              symbol: input.symbol,
              dimension: input.dimension,
            },
          })
        ).id;
      }
      return (
        await prisma.unit.create({
          data: {
            code: input.code,
            name: input.name,
            symbol: input.symbol,
            dimension: input.dimension,
          },
        })
      ).id;
    } catch (error) {
      if (error instanceof MasterDataRepositoryError) throw error;
      throw repositoryError(error, "unit");
    }
  }

  async saveCategory(input: CategoryInput) {
    try {
      if (input.id) {
        const current = await prisma.itemCategory.findUnique({
          where: { id: input.id },
          select: { itemType: true, _count: { select: { items: true } } },
        });
        if (!current)
          throw new MasterDataRepositoryError("not-found", "The category no longer exists.");
        if (current.itemType !== input.itemType && current._count.items > 0) {
          throw new MasterDataRepositoryError(
            "invalid-reference",
            "A category already used by items cannot change item type.",
          );
        }
        return (
          await prisma.itemCategory.update({
            where: { id: input.id },
            data: {
              code: input.code,
              name: input.name,
              itemType: input.itemType,
              description: input.description ?? null,
            },
          })
        ).id;
      }
      return (
        await prisma.itemCategory.create({
          data: {
            code: input.code,
            name: input.name,
            itemType: input.itemType,
            description: input.description ?? null,
          },
        })
      ).id;
    } catch (error) {
      if (error instanceof MasterDataRepositoryError) throw error;
      throw repositoryError(error, "category");
    }
  }

  async saveItem(input: ItemInput) {
    try {
      return await withSerializableRetry(async (transaction) => {
        const category = await transaction.itemCategory.findFirst({
          where: { id: input.categoryId, itemType: input.itemType, active: true },
          select: { id: true },
        });
        const stockUnit = await transaction.unit.findFirst({
          where: { id: input.stockUnitId, active: true },
          select: { id: true, code: true, dimension: true },
        });
        if (!category || !stockUnit) {
          throw new MasterDataRepositoryError(
            "invalid-reference",
            "The selected category or stock unit is no longer valid.",
          );
        }
        if (input.itemType === "FINISHED_GOOD" && !isCanonicalPieceUnit(stockUnit)) {
          throw new MasterDataRepositoryError(
            "invalid-reference",
            "Finished goods must use the active PCS count unit as their stock unit.",
          );
        }

        const itemData = {
          code: input.code,
          name: input.name,
          categoryId: input.categoryId,
          stockUnitId: input.stockUnitId,
          packagingKind: input.itemType === "PACKAGING_MATERIAL" ? input.packagingKind : null,
          description: input.description ?? null,
        };
        let itemId: string;
        if (input.id) {
          const existing = await transaction.item.findFirst({
            where: { id: input.id, itemType: input.itemType },
            select: { stockUnitId: true, _count: { select: { inventoryMovements: true } } },
          });
          if (!existing) {
            throw new MasterDataRepositoryError("not-found", "The item no longer exists.");
          }
          if (
            existing.stockUnitId !== input.stockUnitId &&
            existing._count.inventoryMovements > 0
          ) {
            throw new MasterDataRepositoryError(
              "invalid-reference",
              "An item with inventory movements cannot change its stock unit.",
            );
          }
          const updated = await transaction.item.updateMany({
            where: { id: input.id, itemType: input.itemType },
            data: itemData,
          });
          if (updated.count !== 1) {
            throw new MasterDataRepositoryError("not-found", "The item no longer exists.");
          }
          itemId = input.id;
        } else {
          itemId = (
            await transaction.item.create({ data: { ...itemData, itemType: input.itemType } })
          ).id;
        }

        if (input.itemType === "FINISHED_GOOD") {
          const contentUnit = await transaction.unit.findFirst({
            where: {
              id: input.netContentUnitId,
              active: true,
              dimension: { in: ["MASS", "VOLUME"] },
            },
            select: { id: true, code: true, dimension: true },
          });
          if (!contentUnit) {
            throw new MasterDataRepositoryError(
              "invalid-reference",
              "The net-content unit is no longer valid.",
            );
          }
          if (
            !isSupportedQuantityUnitCode(contentUnit.code) ||
            supportedQuantityUnitDimension(contentUnit.code) !== contentUnit.dimension
          ) {
            throw new MasterDataRepositoryError(
              "invalid-reference",
              "Net-content unit must be a supported mass or volume unit.",
            );
          }
          await transaction.finishedGoodProfile.upsert({
            where: { itemId },
            create: {
              itemId,
              itemType: "FINISHED_GOOD",
              netContentQuantity: input.netContentQuantity,
              netContentUnitId: contentUnit.id,
              netContentUnitDimension: contentUnit.dimension,
              piecesPerCarton: input.piecesPerCarton,
            },
            update: {
              netContentQuantity: input.netContentQuantity,
              netContentUnitId: contentUnit.id,
              netContentUnitDimension: contentUnit.dimension,
              piecesPerCarton: input.piecesPerCarton,
            },
          });
        }
        return itemId;
      });
    } catch (error) {
      if (error instanceof MasterDataRepositoryError) throw error;
      throw repositoryError(error, "item");
    }
  }

  async setUnitActive(id: string, active: boolean) {
    return withSerializableRetry(async (transaction) => {
      if (!active) {
        const activeReferences = await transaction.item.count({
          where: {
            active: true,
            OR: [{ stockUnitId: id }, { finishedGoodProfile: { is: { netContentUnitId: id } } }],
          },
        });
        if (activeReferences > 0) {
          throw new MasterDataRepositoryError(
            "invalid-reference",
            "Deactivate active items that use this unit before deactivating the unit.",
          );
        }
      }
      return (await transaction.unit.updateMany({ where: { id }, data: { active } })).count === 1;
    });
  }

  async setCategoryActive(id: string, active: boolean) {
    return (await prisma.itemCategory.updateMany({ where: { id }, data: { active } })).count === 1;
  }

  async setItemActive(id: string, itemType: ItemType, active: boolean) {
    return withSerializableRetry(async (transaction) => {
      if (active) {
        const item = await transaction.item.findFirst({
          where: { id, itemType },
          include: {
            category: true,
            stockUnit: true,
            finishedGoodProfile: { include: { netContentUnit: true } },
          },
        });
        if (!item) return false;
        const profile = item.finishedGoodProfile;
        const invalidFinishedGood =
          itemType === "FINISHED_GOOD" &&
          (!isCanonicalPieceUnit(item.stockUnit) ||
            !profile ||
            profile.piecesPerCarton <= 0 ||
            profile.netContentQuantity.lte(0) ||
            !profile.netContentUnit.active ||
            !isSupportedQuantityUnitCode(profile.netContentUnit.code) ||
            supportedQuantityUnitDimension(profile.netContentUnit.code) !==
              profile.netContentUnit.dimension ||
            !["MASS", "VOLUME"].includes(profile.netContentUnitDimension) ||
            profile.netContentUnit.dimension !== profile.netContentUnitDimension);
        if (!item.category.active || !item.stockUnit.active || invalidFinishedGood) {
          throw new MasterDataRepositoryError(
            "invalid-reference",
            "Reactivate valid category and unit references before activating this item.",
          );
        }
      }
      return (
        (await transaction.item.updateMany({ where: { id, itemType }, data: { active } })).count ===
        1
      );
    });
  }

  async upsertUnit(input: {
    code: string;
    name: string;
    symbol: string;
    dimension: UnitDimension;
  }) {
    await prisma.unit.upsert({
      where: { code: input.code },
      create: input,
      update: { name: input.name, symbol: input.symbol, dimension: input.dimension },
    });
  }

  async upsertCategory(input: { code: string; name: string; itemType: ItemType }) {
    await prisma.itemCategory.upsert({
      where: { code: input.code },
      create: input,
      update: { name: input.name, itemType: input.itemType },
    });
  }
}

function searchWhere(query: string) {
  const normalized = query.trim();
  return normalized
    ? {
        OR: [
          { code: { contains: normalized, mode: "insensitive" as const } },
          { name: { contains: normalized, mode: "insensitive" as const } },
        ],
      }
    : {};
}

function pageResult<RecordType>(
  records: readonly RecordType[],
  query: ListQuery,
  total: number,
): PaginatedResult<RecordType> {
  return {
    records,
    page: query.page,
    pageSize: query.pageSize,
    total,
    pageCount: Math.max(1, Math.ceil(total / query.pageSize)),
  };
}

function repositoryError(error: unknown, entity: string) {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2002") {
      return new MasterDataRepositoryError(
        "conflict",
        `A ${entity} with this code already exists.`,
      );
    }
    if (error.code === "P2025") {
      return new MasterDataRepositoryError("not-found", `The ${entity} no longer exists.`);
    }
    if (error.code === "P2003" || error.code === "P2004") {
      return new MasterDataRepositoryError(
        "invalid-reference",
        `The ${entity} conflicts with referenced master data.`,
      );
    }
  }
  return error instanceof Error ? error : new Error(`Unknown ${entity} persistence failure.`);
}

async function withSerializableRetry<Result>(
  operation: (transaction: Prisma.TransactionClient) => Promise<Result>,
): Promise<Result> {
  const attempts = 3;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await prisma.$transaction(operation, { isolationLevel: "Serializable" });
    } catch (error) {
      const retryable =
        error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034";
      if (!retryable || attempt === attempts) throw error;
    }
  }
  throw new Error("Serializable transaction retry exhausted.");
}
