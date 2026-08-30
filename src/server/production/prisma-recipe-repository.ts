import "server-only";

import Decimal from "decimal.js";
import { Prisma } from "@/generated/prisma/client";
import { isValidMasterCode } from "@/modules/master-data/domain/master-data";
import type {
  RecipeInput,
  RecipeItemOption,
  RecipePage,
  RecipeQuery,
  RecipeRecord,
  RecipeRepository,
  RecipeSummary,
  RecipeUnit,
} from "@/modules/production/application/contracts";
import { RecipeRepositoryError } from "@/modules/production/application/contracts";
import {
  calculateExpectedYield,
  calculatePackagingRequirements,
  scaleRecipe,
} from "@/modules/production/domain/recipe-calculations";
import {
  isSupportedQuantityUnitCode,
  normalizeQuantity,
  supportedQuantityUnitDimension,
} from "@/modules/quantity/domain/quantity";
import { prisma } from "@/server/db/prisma";
import { recordAuditEvent } from "@/server/audit/audit-event";

const PAGE_SIZE = 25;
const recipeInclude = {
  finishedGood: { include: { finishedGoodProfile: true } },
  standardBatchUnit: true,
  standardBatchCanonicalUnit: true,
  expectedOutputUnit: true,
  expectedOutputCanonicalUnit: true,
  createdBy: true,
  approvedBy: true,
  ingredients: {
    include: { item: true, enteredUnit: true, canonicalUnit: true },
    orderBy: { sequence: "asc" as const },
  },
  packagingBom: {
    include: {
      lines: {
        include: { item: true, enteredUnit: true, canonicalUnit: true },
        orderBy: { sequence: "asc" as const },
      },
    },
  },
} satisfies Prisma.RecipeInclude;
type RecipeRow = Prisma.RecipeGetPayload<{ include: typeof recipeInclude }>;

export class PrismaRecipeRepository implements RecipeRepository {
  async listCatalogItems(): Promise<readonly RecipeItemOption[]> {
    const rows = await prisma.item.findMany({
      where: {
        active: true,
        itemType: { in: ["RAW_MATERIAL", "PACKAGING_MATERIAL", "FINISHED_GOOD"] },
      },
      include: { stockUnit: true, finishedGoodProfile: true },
      orderBy: [{ itemType: "asc" }, { name: "asc" }],
      take: 1000,
    });
    return rows.map((row) => ({
      id: row.id,
      code: row.code,
      name: row.name,
      itemType: row.itemType,
      stockUnitId: row.stockUnitId,
      stockUnitCode: row.stockUnit.code,
      stockUnitSymbol: row.stockUnit.symbol,
      stockUnitDimension: row.stockUnit.dimension,
      active: row.active,
      piecesPerCarton: row.finishedGoodProfile?.piecesPerCarton ?? null,
    }));
  }
  async listRecipeUnits(): Promise<readonly RecipeUnit[]> {
    const rows = await prisma.unit.findMany({
      where: { active: true },
      orderBy: [{ dimension: "asc" }, { name: "asc" }],
    });
    return supportedUnits(rows);
  }
  async createRecipe(input: RecipeInput) {
    return serializable(async (transaction) => {
      if (await transaction.recipe.count({ where: { code: input.code } }))
        throw new RecipeRepositoryError(
          "conflict",
          "Recipe code already exists; use Create New Version from its history.",
        );
      const prepared = await prepareRecipe(transaction, input);
      return (
        await transaction.recipe.create({
          data: {
            code: input.code,
            name: input.name,
            finishedGoodId: prepared.finishedGood.id,
            version: 1,
            ...prepared.header,
            effectiveDate: dateOnly(input.effectiveDate),
            notes: input.notes ?? null,
            createdByUserId: input.actorUserId,
            ingredients: { create: prepared.ingredients },
            packagingBom: { create: { lines: { create: prepared.packagingLines } } },
          },
        })
      ).id;
    });
  }
  async updateRecipe(input: RecipeInput & { id: string }) {
    return serializable(async (transaction) => {
      const current = await transaction.recipe.findUnique({ where: { id: input.id } });
      if (!current || current.status !== "DRAFT")
        throw new RecipeRepositoryError(
          "invalid-state",
          "Only a draft recipe version can be edited.",
        );
      const prepared = await prepareRecipe(transaction, input);
      await transaction.recipeIngredient.deleteMany({ where: { recipeId: input.id } });
      const bom = await transaction.packagingBom.findUnique({ where: { recipeId: input.id } });
      if (bom) await transaction.packagingBomLine.deleteMany({ where: { packagingBomId: bom.id } });
      await transaction.recipe.update({
        where: { id: input.id },
        data: {
          code: input.code,
          name: input.name,
          finishedGoodId: prepared.finishedGood.id,
          ...prepared.header,
          effectiveDate: dateOnly(input.effectiveDate),
          notes: input.notes ?? null,
          ingredients: { create: prepared.ingredients },
          packagingBom: bom
            ? { update: { lines: { create: prepared.packagingLines } } }
            : { create: { lines: { create: prepared.packagingLines } } },
        },
      });
      return input.id;
    });
  }
  async approveRecipe(id: string, actorUserId: string) {
    await serializable(async (transaction) => {
      const row = await transaction.recipe.findUnique({ where: { id }, include: recipeInclude });
      if (!row || row.status !== "DRAFT")
        throw new RecipeRepositoryError("invalid-state", "Only a draft recipe can be approved.");
      await validateApproval(transaction, row);
      const priorApproved = await transaction.recipe.findMany({
        where: { finishedGoodId: row.finishedGoodId, status: "APPROVED", id: { not: row.id } },
        select: { id: true, code: true, version: true, status: true },
      });
      await transaction.recipe.updateMany({
        where: { finishedGoodId: row.finishedGoodId, status: "APPROVED", id: { not: row.id } },
        data: { status: "INACTIVE" },
      });
      await transaction.recipe.update({
        where: { id },
        data: { status: "APPROVED", approvedByUserId: actorUserId, approvedAt: new Date() },
      });
      for (const prior of priorApproved)
        await recordAuditEvent(transaction, {
          actorUserId,
          action: "DEACTIVATE",
          entityType: "MASTER_DATA",
          entityId: prior.id,
          entityReference: `${prior.code}/v${prior.version}`,
          module: "production",
          description: `Inactivated superseded recipe ${prior.code} version ${prior.version}.`,
          beforeSnapshot: { status: prior.status },
          afterSnapshot: { status: "INACTIVE" },
          related: { entityType: "MASTER_DATA", entityId: row.id },
          controlEvent: true,
        });
      await recordAuditEvent(transaction, {
        actorUserId,
        action: "APPROVE",
        entityType: "MASTER_DATA",
        entityId: row.id,
        entityReference: `${row.code}/v${row.version}`,
        module: "production",
        description: `Approved recipe ${row.code} version ${row.version}.`,
        beforeSnapshot: { status: row.status },
        afterSnapshot: { status: "APPROVED" },
        controlEvent: true,
      });
    });
  }
  async inactivateRecipe(id: string, actorUserId: string) {
    await serializable(async (transaction) => {
      const recipe = await transaction.recipe.findUnique({
        where: { id },
        select: { code: true, version: true, status: true },
      });
      const result = await transaction.recipe.updateMany({
        where: { id, status: "APPROVED" },
        data: { status: "INACTIVE" },
      });
      if (result.count !== 1)
        throw new RecipeRepositoryError(
          "invalid-state",
          "Only an approved recipe can be made inactive.",
        );
      await recordAuditEvent(transaction, {
        actorUserId,
        action: "DEACTIVATE",
        entityType: "MASTER_DATA",
        entityId: id,
        entityReference: recipe ? `${recipe.code}/v${recipe.version}` : null,
        module: "production",
        description: `Inactivated recipe ${recipe?.code ?? id}${recipe ? ` version ${recipe.version}` : ""}.`,
        beforeSnapshot: { status: recipe?.status ?? "APPROVED" },
        afterSnapshot: { status: "INACTIVE" },
        controlEvent: true,
      });
    });
  }
  async createNewVersion(id: string, actorUserId: string) {
    return serializable(async (transaction) => {
      const source = await transaction.recipe.findUnique({ where: { id }, include: recipeInclude });
      if (!source) throw new RecipeRepositoryError("not-found", "Recipe no longer exists.");
      const latest = await transaction.recipe.aggregate({
        where: { code: source.code },
        _max: { version: true },
      });
      const created = await transaction.recipe.create({
        data: {
          code: source.code,
          name: source.name,
          finishedGoodId: source.finishedGoodId,
          version: (latest._max.version ?? 0) + 1,
          standardBatchEnteredQuantity: source.standardBatchEnteredQuantity,
          standardBatchUnitId: source.standardBatchUnitId,
          standardBatchUnitDimension: source.standardBatchUnitDimension,
          standardBatchNormalizedQuantity: source.standardBatchNormalizedQuantity,
          standardBatchCanonicalUnitId: source.standardBatchCanonicalUnitId,
          standardBatchCanonicalDimension: source.standardBatchCanonicalDimension,
          expectedOutputEnteredQuantity: source.expectedOutputEnteredQuantity,
          expectedOutputUnitId: source.expectedOutputUnitId,
          expectedOutputUnitDimension: source.expectedOutputUnitDimension,
          expectedOutputNormalizedQuantity: source.expectedOutputNormalizedQuantity,
          expectedOutputCanonicalUnitId: source.expectedOutputCanonicalUnitId,
          expectedOutputCanonicalDimension: source.expectedOutputCanonicalDimension,
          notes: source.notes,
          effectiveDate: null,
          createdByUserId: actorUserId,
          ingredients: {
            create: source.ingredients.map((line) => ({
              sequence: line.sequence,
              itemId: line.itemId,
              enteredQuantity: line.enteredQuantity,
              enteredUnitId: line.enteredUnitId,
              enteredUnitDimension: line.enteredUnitDimension,
              normalizedQuantity: line.normalizedQuantity,
              canonicalUnitId: line.canonicalUnitId,
              canonicalUnitDimension: line.canonicalUnitDimension,
              allowancePercent: line.allowancePercent,
              processNotes: line.processNotes,
            })),
          },
          packagingBom: {
            create: {
              lines: {
                create: (source.packagingBom?.lines ?? []).map((line) => ({
                  sequence: line.sequence,
                  itemId: line.itemId,
                  usageBasis: line.usageBasis,
                  enteredQuantity: line.enteredQuantity,
                  enteredUnitId: line.enteredUnitId,
                  enteredUnitDimension: line.enteredUnitDimension,
                  normalizedQuantity: line.normalizedQuantity,
                  canonicalUnitId: line.canonicalUnitId,
                  canonicalUnitDimension: line.canonicalUnitDimension,
                  allowancePercent: line.allowancePercent,
                  notes: line.notes,
                })),
              },
            },
          },
        },
      });
      await recordAuditEvent(transaction, {
        actorUserId,
        action: "CREATE",
        entityType: "MASTER_DATA",
        entityId: created.id,
        entityReference: `${created.code}/v${created.version}`,
        module: "production",
        description: `Created recipe ${created.code} version ${created.version} from an immutable prior version.`,
        afterSnapshot: { status: created.status, version: created.version },
        related: { entityType: "MASTER_DATA", entityId: source.id },
      });
      return created.id;
    });
  }
  async getRecipe(id: string) {
    const row = await prisma.recipe.findUnique({ where: { id }, include: recipeInclude });
    if (!row) return null;
    const history = await prisma.recipe.findMany({
      where: { code: row.code },
      select: { id: true, version: true, status: true, effectiveDate: true, approvedAt: true },
      orderBy: { version: "desc" },
    });
    return mapRecipe(row, history);
  }
  async listRecipes(query: RecipeQuery): Promise<RecipePage> {
    const where = {
      ...(query.query
        ? {
            OR: [
              { code: { contains: query.query, mode: "insensitive" as const } },
              { name: { contains: query.query, mode: "insensitive" as const } },
              { finishedGood: { name: { contains: query.query, mode: "insensitive" as const } } },
            ],
          }
        : {}),
      ...(query.finishedGoodId ? { finishedGoodId: query.finishedGoodId } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.version ? { version: query.version } : {}),
    };
    const [total, rows] = await prisma.$transaction([
      prisma.recipe.count({ where }),
      prisma.recipe.findMany({
        where,
        include: recipeInclude,
        orderBy: [{ code: "asc" }, { version: "desc" }],
        skip: (query.page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
      }),
    ]);
    return {
      records: rows.map(mapSummary),
      page: query.page,
      pageCount: Math.max(1, Math.ceil(total / PAGE_SIZE)),
      total,
    };
  }
  async scaleRecipe(id: string, targetQuantity: string, targetUnitId: string) {
    const row = await this.getRecipe(id);
    if (!row) throw new RecipeRepositoryError("not-found", "Recipe no longer exists.");
    const units = await this.listRecipeUnits();
    const unit = units.find((candidate) => candidate.id === targetUnitId);
    if (!unit)
      throw new RecipeRepositoryError(
        "invalid-reference",
        "Select an active supported target unit.",
      );
    return scaleRecipe(row, { quantity: targetQuantity, unit }, units);
  }
  async calculatePackaging(id: string, cartons: string, loosePieces: string) {
    const row = await this.getRecipe(id);
    if (!row) throw new RecipeRepositoryError("not-found", "Recipe no longer exists.");
    return calculatePackagingRequirements(
      {
        piecesPerCarton: row.piecesPerCarton,
        lines: row.packagingLines.map((line) => ({
          ...line,
          itemCode: line.itemCode,
          itemName: line.itemName,
        })),
      },
      cartons,
      loosePieces,
    );
  }
}

async function prepareRecipe(transaction: Prisma.TransactionClient, input: RecipeInput) {
  if (!isValidMasterCode(input.code))
    throw new RecipeRepositoryError(
      "invalid-reference",
      "Recipe code must contain uppercase letters, numbers, and hyphens only.",
    );
  const itemIds = [
    ...new Set([
      input.finishedGoodId,
      ...input.ingredients.map((line) => line.itemId),
      ...input.packagingLines.map((line) => line.itemId),
    ]),
  ];
  const unitIds = [
    ...new Set([
      input.standardBatchUnitId,
      ...(input.expectedOutputUnitId ? [input.expectedOutputUnitId] : []),
      ...input.ingredients.map((line) => line.unitId),
      ...input.packagingLines.map((line) => line.unitId),
    ]),
  ];
  const [items, allUnits] = await Promise.all([
    transaction.item.findMany({
      where: { id: { in: itemIds }, active: true },
      include: { stockUnit: true, finishedGoodProfile: true },
    }),
    transaction.unit.findMany({ where: { active: true } }),
  ]);
  const units = supportedUnits(allUnits);
  if (items.length !== itemIds.length)
    throw new RecipeRepositoryError(
      "invalid-reference",
      "Recipe contains an inactive or invalid item.",
    );
  if (unitIds.some((id) => !units.some((unit) => unit.id === id)))
    throw new RecipeRepositoryError(
      "invalid-reference",
      "Recipe contains an inactive or unsupported unit.",
    );
  const finishedGood = items.find(
    (item) =>
      item.id === input.finishedGoodId &&
      item.itemType === "FINISHED_GOOD" &&
      item.finishedGoodProfile,
  );
  if (!finishedGood)
    throw new RecipeRepositoryError(
      "invalid-reference",
      "Select an active finished good with a valid product profile.",
    );
  if (new Set(input.ingredients.map((line) => line.itemId)).size !== input.ingredients.length)
    throw new RecipeRepositoryError(
      "invalid-reference",
      "Each raw material may appear only once per recipe version.",
    );
  if (
    new Set(input.packagingLines.map((line) => `${line.itemId}:${line.usageBasis}`)).size !==
    input.packagingLines.length
  )
    throw new RecipeRepositoryError(
      "invalid-reference",
      "Each packaging item and usage basis may appear only once.",
    );
  const batch = normalized(
    input.standardBatchQuantity,
    input.standardBatchUnitId,
    units,
    "Standard batch quantity",
  );
  const output =
    input.expectedOutputQuantity && input.expectedOutputUnitId
      ? normalized(
          input.expectedOutputQuantity,
          input.expectedOutputUnitId,
          units,
          "Expected output quantity",
        )
      : null;
  const ingredients = input.ingredients.map((line, index) => {
    const item = items.find(
      (candidate) => candidate.id === line.itemId && candidate.itemType === "RAW_MATERIAL",
    );
    if (!item)
      throw new RecipeRepositoryError(
        "invalid-reference",
        `Ingredient line ${index + 1} must use an active raw material.`,
      );
    const quantity = normalized(
      line.quantity,
      line.unitId,
      units,
      `Ingredient line ${index + 1} quantity`,
    );
    if (quantity.canonical.id !== item.stockUnitId)
      throw new RecipeRepositoryError(
        "invalid-reference",
        `Ingredient line ${index + 1} unit is incompatible with the raw material stock unit.`,
      );
    return {
      sequence: index + 1,
      itemId: item.id,
      enteredQuantity: quantity.entered.toFixed(),
      enteredUnitId: quantity.unit.id,
      enteredUnitDimension: quantity.unit.dimension,
      normalizedQuantity: quantity.normalized.toFixed(),
      canonicalUnitId: quantity.canonical.id,
      canonicalUnitDimension: quantity.canonical.dimension,
      allowancePercent: allowance(line.allowancePercent),
      processNotes: line.processNotes ?? null,
    };
  });
  const packagingLines = input.packagingLines.map((line, index) => {
    const item = items.find(
      (candidate) => candidate.id === line.itemId && candidate.itemType === "PACKAGING_MATERIAL",
    );
    if (!item)
      throw new RecipeRepositoryError(
        "invalid-reference",
        `Packaging line ${index + 1} must use an active packaging material.`,
      );
    const quantity = normalized(
      line.quantity,
      line.unitId,
      units,
      `Packaging line ${index + 1} quantity`,
    );
    if (quantity.canonical.id !== item.stockUnitId)
      throw new RecipeRepositoryError(
        "invalid-reference",
        `Packaging line ${index + 1} unit is incompatible with the packaging material stock unit.`,
      );
    return {
      sequence: index + 1,
      itemId: item.id,
      usageBasis: line.usageBasis,
      enteredQuantity: quantity.entered.toFixed(),
      enteredUnitId: quantity.unit.id,
      enteredUnitDimension: quantity.unit.dimension,
      normalizedQuantity: quantity.normalized.toFixed(),
      canonicalUnitId: quantity.canonical.id,
      canonicalUnitDimension: quantity.canonical.dimension,
      allowancePercent: allowance(line.allowancePercent),
      notes: line.notes ?? null,
    };
  });
  return {
    finishedGood,
    header: {
      standardBatchEnteredQuantity: batch.entered.toFixed(),
      standardBatchUnitId: batch.unit.id,
      standardBatchUnitDimension: batch.unit.dimension,
      standardBatchNormalizedQuantity: batch.normalized.toFixed(),
      standardBatchCanonicalUnitId: batch.canonical.id,
      standardBatchCanonicalDimension: batch.canonical.dimension,
      expectedOutputEnteredQuantity: output?.entered.toFixed() ?? null,
      expectedOutputUnitId: output?.unit.id ?? null,
      expectedOutputUnitDimension: output?.unit.dimension ?? null,
      expectedOutputNormalizedQuantity: output?.normalized.toFixed() ?? null,
      expectedOutputCanonicalUnitId: output?.canonical.id ?? null,
      expectedOutputCanonicalDimension: output?.canonical.dimension ?? null,
    },
    ingredients,
    packagingLines,
  };
}

async function validateApproval(transaction: Prisma.TransactionClient, row: RecipeRow) {
  const [finishedGood, ingredientCount, packagingCount, units] = await Promise.all([
    transaction.item.count({
      where: {
        id: row.finishedGoodId,
        itemType: "FINISHED_GOOD",
        active: true,
        finishedGoodProfile: { isNot: null },
      },
    }),
    transaction.item.count({
      where: {
        id: { in: row.ingredients.map((line) => line.itemId) },
        itemType: "RAW_MATERIAL",
        active: true,
      },
    }),
    transaction.item.count({
      where: {
        id: { in: (row.packagingBom?.lines ?? []).map((line) => line.itemId) },
        itemType: "PACKAGING_MATERIAL",
        active: true,
      },
    }),
    transaction.unit.count({
      where: {
        id: {
          in: [
            row.standardBatchUnitId,
            ...(row.expectedOutputUnitId ? [row.expectedOutputUnitId] : []),
            ...row.ingredients.map((line) => line.enteredUnitId),
            ...(row.packagingBom?.lines ?? []).map((line) => line.enteredUnitId),
          ],
        },
        active: true,
      },
    }),
  ]);
  const expectedUnits = new Set([
    row.standardBatchUnitId,
    ...(row.expectedOutputUnitId ? [row.expectedOutputUnitId] : []),
    ...row.ingredients.map((line) => line.enteredUnitId),
    ...(row.packagingBom?.lines ?? []).map((line) => line.enteredUnitId),
  ]).size;
  if (
    finishedGood !== 1 ||
    row.ingredients.length === 0 ||
    ingredientCount !== new Set(row.ingredients.map((line) => line.itemId)).size ||
    packagingCount !== new Set((row.packagingBom?.lines ?? []).map((line) => line.itemId)).size ||
    units !== expectedUnits
  )
    throw new RecipeRepositoryError(
      "invalid-reference",
      "Recipe approval requires active finished-good, ingredient, packaging, and unit references.",
    );
}

function mapRecipe(row: RecipeRow, history: RecipeRecord["history"]): RecipeRecord {
  const base = mapBase(row);
  return {
    ...base,
    ingredients: row.ingredients.map((line) => ({
      id: line.id,
      sequence: line.sequence,
      itemId: line.itemId,
      itemCode: line.item.code,
      itemName: line.item.name,
      enteredQuantity: line.enteredQuantity.toString(),
      enteredUnitId: line.enteredUnitId,
      enteredUnitCode: line.enteredUnit.code,
      enteredUnitSymbol: line.enteredUnit.symbol,
      normalizedQuantity: line.normalizedQuantity.toString(),
      canonicalUnitId: line.canonicalUnitId,
      canonicalUnitCode: line.canonicalUnit.code,
      canonicalUnitSymbol: line.canonicalUnit.symbol,
      canonicalUnitDimension: line.canonicalUnitDimension,
      allowancePercent: line.allowancePercent.toString(),
      processNotes: line.processNotes,
    })),
    packagingLines: (row.packagingBom?.lines ?? []).map((line) => ({
      id: line.id,
      sequence: line.sequence,
      itemId: line.itemId,
      itemCode: line.item.code,
      itemName: line.item.name,
      usageBasis: line.usageBasis,
      enteredQuantity: line.enteredQuantity.toString(),
      enteredUnitId: line.enteredUnitId,
      enteredUnitCode: line.enteredUnit.code,
      enteredUnitSymbol: line.enteredUnit.symbol,
      normalizedQuantity: line.normalizedQuantity.toString(),
      canonicalUnitId: line.canonicalUnitId,
      canonicalUnitCode: line.canonicalUnit.code,
      canonicalUnitSymbol: line.canonicalUnit.symbol,
      canonicalUnitDimension: line.canonicalUnitDimension,
      allowancePercent: line.allowancePercent.toString(),
      notes: line.notes,
    })),
    history,
  };
}
function mapSummary(row: RecipeRow): RecipeSummary {
  return mapBase(row);
}
function mapBase(row: RecipeRow) {
  const yieldPercent = calculateExpectedYield({
    standardBatchNormalizedQuantity: row.standardBatchNormalizedQuantity.toString(),
    standardBatchDimension: row.standardBatchCanonicalDimension,
    expectedOutputNormalizedQuantity: row.expectedOutputNormalizedQuantity?.toString() ?? null,
    expectedOutputDimension: row.expectedOutputCanonicalDimension,
  });
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    finishedGoodId: row.finishedGoodId,
    finishedGoodCode: row.finishedGood.code,
    finishedGoodName: row.finishedGood.name,
    piecesPerCarton: row.finishedGood.finishedGoodProfile!.piecesPerCarton,
    version: row.version,
    status: row.status,
    standardBatchEnteredQuantity: row.standardBatchEnteredQuantity.toString(),
    standardBatchUnitId: row.standardBatchUnitId,
    standardBatchUnitCode: row.standardBatchUnit.code,
    standardBatchUnitSymbol: row.standardBatchUnit.symbol,
    standardBatchNormalizedQuantity: row.standardBatchNormalizedQuantity.toString(),
    standardBatchCanonicalUnitId: row.standardBatchCanonicalUnitId,
    standardBatchCanonicalCode: row.standardBatchCanonicalUnit.code,
    standardBatchCanonicalSymbol: row.standardBatchCanonicalUnit.symbol,
    standardBatchDimension: row.standardBatchCanonicalDimension,
    expectedOutputEnteredQuantity: row.expectedOutputEnteredQuantity?.toString() ?? null,
    expectedOutputUnitId: row.expectedOutputUnitId,
    expectedOutputUnitCode: row.expectedOutputUnit?.code ?? null,
    expectedOutputUnitSymbol: row.expectedOutputUnit?.symbol ?? null,
    expectedOutputNormalizedQuantity: row.expectedOutputNormalizedQuantity?.toString() ?? null,
    expectedOutputCanonicalUnitId: row.expectedOutputCanonicalUnitId,
    expectedOutputCanonicalCode: row.expectedOutputCanonicalUnit?.code ?? null,
    expectedOutputCanonicalSymbol: row.expectedOutputCanonicalUnit?.symbol ?? null,
    expectedOutputDimension: row.expectedOutputCanonicalDimension,
    expectedYieldPercent: yieldPercent,
    notes: row.notes,
    effectiveDate: row.effectiveDate,
    createdByName: row.createdBy.name,
    approvedByName: row.approvedBy?.name ?? null,
    approvedAt: row.approvedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function supportedUnits<
  T extends {
    id: string;
    code: string;
    name: string;
    symbol: string;
    dimension: "MASS" | "VOLUME" | "COUNT";
    active: boolean;
  },
>(rows: readonly T[]): T[] {
  return rows.filter(
    (unit) =>
      isSupportedQuantityUnitCode(unit.code) &&
      supportedQuantityUnitDimension(unit.code) === unit.dimension,
  );
}
function normalized(value: string, unitId: string, units: readonly RecipeUnit[], label: string) {
  const unit = units.find((candidate) => candidate.id === unitId);
  if (!unit) throw new RecipeRepositoryError("invalid-reference", `${label} unit is invalid.`);
  let entered: Decimal;
  try {
    entered = new Decimal(value);
  } catch {
    throw new RecipeRepositoryError("invalid-reference", `${label} is invalid.`);
  }
  if (
    !entered.isFinite() ||
    entered.lte(0) ||
    entered.decimalPlaces() > 6 ||
    entered.gt("999999999999999999.999999")
  )
    throw new RecipeRepositoryError(
      "invalid-reference",
      `${label} is outside the supported range.`,
    );
  const result = normalizeQuantity({ amount: entered.toFixed(), unit }, units);
  const canonical = units.find((candidate) => candidate.code === result.unit.code)!;
  return { entered, unit, normalized: new Decimal(result.amount), canonical };
}
function allowance(value: string) {
  const amount = new Decimal(value || 0);
  if (!amount.isFinite() || amount.lt(0) || amount.decimalPlaces() > 4 || amount.gt("999.9999"))
    throw new RecipeRepositoryError(
      "invalid-reference",
      "Allowance percentage is outside the supported range.",
    );
  return amount.toFixed();
}
function dateOnly(value?: string) {
  if (!value) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== value)
    throw new RecipeRepositoryError("invalid-reference", "Effective date is invalid.");
  return date;
}
async function serializable<T>(operation: (transaction: Prisma.TransactionClient) => Promise<T>) {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await prisma.$transaction(operation, { isolationLevel: "Serializable" });
    } catch (error) {
      const retryable =
        error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034";
      if (!retryable || attempt === 3) throw mapError(error);
    }
  }
  throw new RecipeRepositoryError("conflict", "Recipe transaction conflict; retry.");
}
function mapError(error: unknown) {
  if (error instanceof RecipeRepositoryError) return error;
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2002")
      return new RecipeRepositoryError(
        "conflict",
        "Recipe code/version or line identity already exists.",
      );
    if (["P2003", "P2004"].includes(error.code))
      return new RecipeRepositoryError(
        "invalid-reference",
        "Recipe data conflicts with protected master references.",
      );
  }
  return error instanceof Error
    ? error
    : new RecipeRepositoryError("conflict", "Recipe operation failed.");
}
