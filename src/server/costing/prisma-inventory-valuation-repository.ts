import "server-only";

import Decimal from "decimal.js";
import { Prisma, type ItemType } from "@/generated/prisma/client";
import type {
  InventoryValuationRepository,
  LandedCostInput,
  ProductionCostEntryInput,
  ValuationQuery,
} from "@/modules/costing/application/contracts";
import { CostingRepositoryError } from "@/modules/costing/application/contracts";
import { allocateByWeights, exactCost, exactSignedCost } from "@/modules/costing/domain/costing";
import { prisma } from "@/server/db/prisma";
import {
  InventoryValuationError,
  postHistoricalUnvaluedOutbound,
  postMissingValuationBasis,
  postValuedInbound,
  postValuedOutbound,
  postValueAdjustment,
  resolveExhaustedValuationIssue,
} from "@/server/inventory/transactional-inventory-valuation";

type Client = Prisma.TransactionClient | typeof prisma;

export class PrismaInventoryValuationRepository implements InventoryValuationRepository {
  async listValuationReferences() {
    return {
      categories: await prisma.itemCategory.findMany({
        select: { id: true, name: true },
        orderBy: { name: "asc" },
      }),
    };
  }
  async listValuation(query: ValuationQuery) {
    const items = await prisma.item.findMany({
      where: {
        ...(query.query
          ? {
              OR: [
                { code: { contains: query.query, mode: "insensitive" } },
                { name: { contains: query.query, mode: "insensitive" } },
              ],
            }
          : {}),
        ...(query.itemType ? { itemType: query.itemType } : {}),
        ...(query.categoryId ? { categoryId: query.categoryId } : {}),
        ...(query.active === undefined ? {} : { active: query.active }),
        ...(query.missingOnly
          ? { inventoryValuationBalance: { missingBasisCount: { gt: 0 } } }
          : {}),
      },
      include: {
        category: true,
        stockUnit: true,
        finishedGoodProfile: true,
        inventoryValuationBalance: true,
      },
      orderBy: [{ itemType: "asc" }, { name: "asc" }],
      take: 1000,
    });
    const physical = await prisma.inventoryMovement.groupBy({
      by: ["itemId"],
      where: { itemId: { in: items.map((item) => item.id) } },
      _sum: { quantity: true },
    });
    return items.map((item) =>
      summary(
        item,
        physical.find((row) => row.itemId === item.id)?._sum.quantity?.toString() ?? "0",
      ),
    );
  }

  async getItemHistory(itemId: string) {
    const item = await prisma.item.findUnique({
      where: { id: itemId },
      include: {
        category: true,
        stockUnit: true,
        finishedGoodProfile: true,
        inventoryValuationBalance: true,
      },
    });
    if (!item) return null;
    const [physical, rows] = await Promise.all([
      prisma.inventoryMovement.aggregate({ where: { itemId }, _sum: { quantity: true } }),
      prisma.inventoryValuationEntry.findMany({
        where: { itemId },
        include: { createdBy: true },
        orderBy: [{ effectiveAt: "desc" }, { id: "desc" }],
        take: 1000,
      }),
    ]);
    return {
      summary: summary(item, physical._sum.quantity?.toString() ?? "0"),
      history: rows.map((row) => ({
        id: row.id,
        effectiveAt: row.effectiveAt,
        entryType: row.entryType,
        state: row.state,
        sourceType: row.sourceType,
        sourceNumber: row.sourceNumber,
        quantityEffect: row.quantityEffect.toString(),
        unitCost: row.unitCost?.toString() ?? null,
        valueDelta: row.valueDelta?.toString() ?? null,
        runningOwnedQuantity: row.runningOwnedQuantity.toString(),
        runningInventoryValue: row.runningInventoryValue.toString(),
        resultingAverageUnitCost: row.resultingAverageUnitCost?.toString() ?? null,
        notes: row.notes,
        createdByName: row.createdBy.name,
      })),
    };
  }

  async listUnresolvedIssues() {
    const rows = await prisma.inventoryValuationIssue.findMany({
      where: { resolvedAt: null },
      include: { item: true },
      orderBy: [{ detectedAt: "asc" }, { id: "asc" }],
    });
    return rows.map((row) => ({
      id: row.id,
      itemId: row.itemId,
      itemCode: row.item.code,
      itemName: row.item.name,
      quantity: row.quantity.toString(),
      reasonCode: row.reasonCode,
      description: row.description,
      detectedAt: row.detectedAt,
    }));
  }

  async initializeIssue(
    issueId: string,
    totalValue: string,
    reason: string,
    reference: string | undefined,
    actorUserId: string,
  ) {
    return serializable(async (tx) => {
      const issue = await tx.inventoryValuationIssue.findUnique({ where: { id: issueId } });
      if (!issue || issue.resolvedAt)
        throw new CostingRepositoryError("Valuation issue is no longer unresolved.");
      const balance = await tx.inventoryValuationBalance.findUnique({
        where: { itemId: issue.itemId },
      });
      if (balance?.ownedQuantity.isZero()) {
        const value = exactCost(totalValue, "Initialization value", true);
        if (!value.isZero())
          throw new CostingRepositoryError(
            "An exhausted historical quantity must be resolved with zero current inventory value.",
          );
        await resolveExhaustedValuationIssue(tx, {
          sourceKey: `VALUATION-INIT-EXHAUSTED:${issue.id}`,
          itemId: issue.itemId,
          entryType: "VALUATION_INITIALIZATION",
          effectiveAt: new Date(),
          sourceType: "VALUATION_ISSUE",
          sourceId: issue.id,
          notes: reason,
          actorUserId,
          resolvedIssueId: issue.id,
        });
        return issue.id;
      }
      const value = exactCost(totalValue, "Initialization value");
      const year = new Date().getUTCFullYear();
      const number = await adjustmentNumber(tx, year);
      const adjustment = await tx.inventoryValuationAdjustment.create({
        data: {
          number,
          itemId: issue.itemId,
          valueDelta: value.toFixed(6),
          reason,
          reference: reference ?? null,
          createdByUserId: actorUserId,
        },
      });
      await postValueAdjustment(tx, {
        sourceKey: `VALUATION-INIT:${adjustment.id}`,
        itemId: issue.itemId,
        entryType: "VALUATION_INITIALIZATION",
        effectiveAt: adjustment.createdAt,
        sourceType: "VALUATION_ADJUSTMENT",
        sourceId: adjustment.id,
        sourceNumber: number,
        notes: reason,
        actorUserId,
        valueDelta: value.toFixed(6),
        resolvedIssueId: issue.id,
        adjustmentId: adjustment.id,
      });
      return adjustment.id;
    });
  }

  async rebuild(actorUserId: string) {
    return serializable(async (tx) => rebuildValuation(tx, actorUserId));
  }

  async adjustItemValue(
    itemId: string,
    valueDelta: string,
    reason: string,
    reference: string | undefined,
    actorUserId: string,
  ) {
    return serializable(async (tx) => {
      const item = await tx.item.findUnique({ where: { id: itemId }, select: { id: true } });
      if (!item) throw new CostingRepositoryError("Inventory item no longer exists.");
      const value = exactSignedCost(valueDelta, "Valuation adjustment");
      const year = new Date().getUTCFullYear();
      const number = await adjustmentNumber(tx, year);
      const adjustment = await tx.inventoryValuationAdjustment.create({
        data: {
          number,
          itemId,
          valueDelta: value.toFixed(6),
          reason,
          reference: reference ?? null,
          createdByUserId: actorUserId,
        },
      });
      await postValueAdjustment(tx, {
        sourceKey: `VALUATION-ADJUSTMENT:${adjustment.id}`,
        itemId,
        entryType: "COST_ADJUSTMENT",
        effectiveAt: adjustment.createdAt,
        sourceType: "VALUATION_ADJUSTMENT",
        sourceId: adjustment.id,
        sourceNumber: number,
        notes: reason,
        actorUserId,
        valueDelta: value.toFixed(6),
        adjustmentId: adjustment.id,
      });
      return adjustment.id;
    });
  }

  async listPostedGoodsReceipts() {
    const rows = await prisma.goodsReceipt.findMany({
      where: { status: { in: ["POSTED", "QC_COMPLETED"] } },
      include: {
        supplier: true,
        lines: { include: { purchaseOrderLine: { include: { item: true } } } },
      },
      orderBy: [{ receiptDate: "desc" }, { number: "desc" }],
      take: 500,
    });
    return rows.map((row) => ({
      id: row.id,
      number: row.number,
      supplierName: row.supplier.name,
      lines: row.lines.map((line) => ({
        id: line.id,
        itemCode: line.purchaseOrderLine.item.code,
        itemName: line.purchaseOrderLine.item.name,
        quantity: line.normalizedQuantity.toString(),
        baseValue: purchaseBaseValue(
          line.purchaseOrderLine,
          line.normalizedQuantity.toString(),
        ).value.toFixed(6),
      })),
    }));
  }

  async createAndPostLandedCost(input: LandedCostInput) {
    return serializable(async (tx) => {
      const receipt = await tx.goodsReceipt.findUnique({
        where: { id: input.goodsReceiptId },
        include: {
          lines: { include: { purchaseOrderLine: { include: { canonicalUnit: true } } } },
        },
      });
      if (!receipt || !["POSTED", "QC_COMPLETED"].includes(receipt.status))
        throw new CostingRepositoryError("Select a posted goods receipt.");
      const total = exactCost(input.totalAmount, "Landed cost total");
      const submitted = new Map(
        input.allocations.map((line) => [line.goodsReceiptLineId, line.allocatedAmount]),
      );
      if (
        submitted.size !== receipt.lines.length ||
        receipt.lines.some((line) => !submitted.has(line.id))
      )
        throw new CostingRepositoryError(
          "Allocate landed cost to every receipt line exactly once.",
        );
      let allocations: string[];
      if (input.allocationMethod === "BY_LINE_VALUE")
        allocations = allocateByWeights(
          total.toFixed(),
          receipt.lines.map((line) =>
            purchaseBaseValue(
              line.purchaseOrderLine,
              line.normalizedQuantity.toString(),
            ).value.toFixed(),
          ),
        );
      else if (input.allocationMethod === "BY_QUANTITY") {
        if (
          new Set(receipt.lines.map((line) => line.purchaseOrderLine.canonicalUnit.dimension))
            .size !== 1
        )
          throw new CostingRepositoryError(
            "BY_QUANTITY cannot allocate across incompatible quantity dimensions.",
          );
        allocations = allocateByWeights(
          total.toFixed(),
          receipt.lines.map((line) => line.normalizedQuantity.toString()),
        );
      } else
        allocations = receipt.lines.map((line) =>
          exactCost(submitted.get(line.id)!, "Manual allocation", true).toFixed(6),
        );
      if (!sum(allocations).eq(total))
        throw new CostingRepositoryError("Allocated landed cost must equal the document total.");
      const number = await landedCostNumber(tx, new Date().getUTCFullYear());
      const document = await tx.landedCost.create({
        data: {
          number,
          goodsReceiptId: receipt.id,
          allocationMethod: input.allocationMethod,
          status: "POSTED",
          category: input.category,
          totalAmount: total.toFixed(6),
          description: input.description,
          reference: input.reference ?? null,
          createdByUserId: input.actorUserId,
          postedByUserId: input.actorUserId,
          postedAt: new Date(),
          allocations: {
            create: receipt.lines.map((line, index) => ({
              goodsReceiptLineId: line.id,
              allocatedAmount: allocations[index]!,
            })),
          },
        },
      });
      for (const [index, line] of receipt.lines.entries())
        await postValueAdjustment(tx, {
          sourceKey: `LANDED-COST:${document.id}:${line.id}`,
          itemId: line.itemId,
          entryType: "LANDED_COST",
          effectiveAt: document.postedAt!,
          sourceType: "LANDED_COST",
          sourceId: document.id,
          sourceNumber: document.number,
          notes: input.description,
          actorUserId: input.actorUserId,
          valueDelta: allocations[index]!,
        });
      return document.id;
    });
  }

  async getBatchCosting(batchId: string) {
    return batchCosting(prisma, batchId);
  }

  async addProductionCostEntry(input: ProductionCostEntryInput) {
    return serializable(async (tx) => {
      const batch = await tx.productionBatch.findUnique({
        where: { id: input.productionBatchId },
        include: { productionCostSnapshot: true },
      });
      if (!batch || batch.productionCostSnapshot)
        throw new CostingRepositoryError("Finalized or missing batch cost cannot be changed.");
      const amount = exactCost(input.amount, "Production cost amount");
      return (
        await tx.productionCostEntry.create({
          data: {
            productionBatchId: batch.id,
            category: input.category,
            amount: amount.toFixed(6),
            description: input.description,
            reference: input.reference ?? null,
            createdByUserId: input.actorUserId,
          },
        })
      ).id;
    });
  }

  async finalizeBatchCost(batchId: string, actorUserId: string) {
    await serializable(async (tx) => {
      const calculation = await batchCosting(tx, batchId);
      if (!calculation) throw new CostingRepositoryError("Production batch no longer exists.");
      if (calculation.batchStatus !== "COMPLETED")
        throw new CostingRepositoryError(
          "Only a completed production batch can be cost-finalized.",
        );
      if (calculation.costingStatus === "FINALIZED")
        throw new CostingRepositoryError("Batch cost is already finalized.");
      if (
        calculation.warnings.length ||
        !calculation.rawMaterialCost ||
        !calculation.packagingCost ||
        !calculation.finishedGoodsCostPool ||
        !calculation.costPerPiece
      )
        throw new CostingRepositoryError(calculation.warnings[0] ?? "Batch costing is unresolved.");
      const batch = await tx.productionBatch.findUniqueOrThrow({
        where: { id: batchId },
        include: {
          productionLot: true,
          outputTransactions: {
            where: { status: "POSTED", outputType: "GOOD" },
            include: { inventoryMovements: true },
          },
        },
      });
      if (!batch.productionLot)
        throw new CostingRepositoryError("Completed batch is missing its finished production lot.");
      const snapshot = await tx.productionBatchCostSnapshot.create({
        data: {
          productionBatchId: batch.id,
          productionLotId: batch.productionLot.id,
          status: "FINALIZED",
          rawMaterialCost: calculation.rawMaterialCost,
          packagingCost: calculation.packagingCost,
          additionalCost: calculation.additionalCost,
          costCredits: calculation.costCredits,
          damagedPackagingExposure: calculation.damagedPackagingExposure ?? "0",
          finishedGoodsCostPool: calculation.finishedGoodsCostPool,
          actualGoodPieces: calculation.actualGoodPieces,
          costPerPiece: calculation.costPerPiece,
          calculationSnapshot: JSON.parse(JSON.stringify(calculation)),
          finalizedByUserId: actorUserId,
        },
      });
      for (const output of batch.outputTransactions) {
        const movement = output.inventoryMovements.find(
          (row) => row.movementType === "PRODUCTION_OUTPUT" && row.quantity.gt(0),
        );
        if (!movement)
          throw new CostingRepositoryError(
            "A posted good output is missing its physical movement.",
          );
        await postValuedInbound(tx, {
          sourceKey: `PRODUCTION-OUTPUT:${output.id}`,
          itemId: movement.itemId,
          inventoryMovementId: movement.id,
          entryType: "PRODUCTION_OUTPUT",
          effectiveAt: output.postedAt ?? output.transactionDate,
          sourceType: "PRODUCTION_OUTPUT",
          sourceId: output.id,
          sourceNumber: output.outputNumber,
          productionBatchId: batch.id,
          productionLotId: batch.productionLot.id,
          notes: `Finalized batch cost ${snapshot.id}.`,
          actorUserId,
          quantity: movement.quantity.toString(),
          unitCost: calculation.costPerPiece,
        });
      }
      const outputValue = money(
        sum(
          batch.outputTransactions.map((output) =>
            money(
              new Decimal(output.totalPieces?.toString() ?? "0").mul(calculation.costPerPiece!),
            ).toFixed(6),
          ),
        ),
      );
      const roundingResidual = money(
        new Decimal(calculation.finishedGoodsCostPool).sub(outputValue),
      );
      if (!roundingResidual.isZero())
        await postValueAdjustment(tx, {
          sourceKey: `PRODUCTION-OUTPUT-ROUNDING:${batch.id}`,
          itemId: batch.finishedGoodId,
          entryType: "COST_ADJUSTMENT",
          effectiveAt: snapshot.finalizedAt,
          sourceType: "PRODUCTION_BATCH_COST",
          sourceId: snapshot.id,
          sourceNumber: calculation.batchNumber,
          productionBatchId: batch.id,
          productionLotId: batch.productionLot.id,
          notes: "Exact finished-goods cost-pool rounding reconciliation.",
          actorUserId,
          valueDelta: roundingResidual.toFixed(6),
        });
    });
  }
}

export async function valueGoodsReceipt(
  tx: Prisma.TransactionClient,
  goodsReceiptId: string,
  actorUserId: string,
) {
  const receipt = await tx.goodsReceipt.findUnique({
    where: { id: goodsReceiptId },
    include: {
      lines: {
        include: { purchaseOrderLine: true, inventoryLot: true },
        orderBy: [{ position: "asc" }, { id: "asc" }],
      },
    },
  });
  if (!receipt) throw new CostingRepositoryError("Goods receipt costing source is missing.");
  for (const line of receipt.lines) {
    const movement = await tx.inventoryMovement.findUnique({
      where: {
        sourceKey_movementType: {
          sourceKey: `GRN:${line.id}:RECEIPT`,
          movementType: "PURCHASE_RECEIPT",
        },
      },
    });
    if (!movement || !line.inventoryLot)
      throw new CostingRepositoryError("Goods receipt inventory provenance is missing.");
    const basis = purchaseBaseValue(line.purchaseOrderLine, line.normalizedQuantity.toString());
    await postValuedInbound(tx, {
      sourceKey: `GRN-COST:${line.id}`,
      itemId: line.itemId,
      inventoryMovementId: movement.id,
      entryType:
        receipt.purpose === "SUPPLIER_REPLACEMENT" ? "SUPPLIER_REPLACEMENT" : "PURCHASE_RECEIPT",
      effectiveAt: movement.postedAt,
      sourceType: "GOODS_RECEIPT",
      sourceId: receipt.id,
      sourceNumber: receipt.number,
      inventoryLotId: line.inventoryLot.id,
      notes:
        receipt.purpose === "SUPPLIER_REPLACEMENT"
          ? "Original acquisition basis restored; no second supplier charge."
          : "Net purchase value before tax.",
      actorUserId,
      quantity: line.normalizedQuantity.toString(),
      unitCost: basis.unitCost.toFixed(12),
    });
  }
}

export async function valuePurchaseReturn(
  tx: Prisma.TransactionClient,
  purchaseReturnId: string,
  actorUserId: string,
  historical = false,
) {
  const document = await tx.purchaseReturn.findUnique({
    where: { id: purchaseReturnId },
    include: { lines: { orderBy: [{ position: "asc" }, { id: "asc" }] } },
  });
  if (!document) throw new CostingRepositoryError("Purchase return costing source is missing.");
  for (const line of document.lines) {
    const movement = await tx.inventoryMovement.findUnique({
      where: {
        sourceKey_movementType: {
          sourceKey: `PURCHASE-RETURN:${line.id}`,
          movementType: "PURCHASE_RETURN",
        },
      },
    });
    if (!movement)
      throw new CostingRepositoryError("Purchase return inventory provenance is missing.");
    await postOutbound(tx, historical, {
      sourceKey: `PURCHASE-RETURN-COST:${line.id}`,
      itemId: line.itemId,
      inventoryMovementId: movement.id,
      entryType: "PURCHASE_RETURN",
      effectiveAt: movement.postedAt,
      sourceType: "PURCHASE_RETURN",
      sourceId: document.id,
      sourceNumber: document.number,
      inventoryLotId: line.inventoryLotId,
      actorUserId,
      quantity: line.normalizedQuantity.toString(),
    });
  }
}

export async function valueProductionConsumption(
  tx: Prisma.TransactionClient,
  transactionId: string,
  actorUserId: string,
  historical = false,
) {
  const document = await tx.productionMaterialTransaction.findUnique({
    where: { id: transactionId },
    include: { lines: { orderBy: [{ position: "asc" }, { id: "asc" }] } },
  });
  if (!document || document.transactionType !== "CONSUMPTION") return;
  for (const line of document.lines) {
    const movement = await tx.inventoryMovement.findUnique({
      where: {
        sourceKey_movementType: {
          sourceKey: `PMT:${line.id}:CONSUMPTION`,
          movementType:
            document.materialType === "RAW_MATERIAL"
              ? "PRODUCTION_CONSUMPTION"
              : "PACKAGING_CONSUMPTION",
        },
      },
    });
    if (!movement)
      throw new CostingRepositoryError("Production consumption inventory provenance is missing.");
    await postOutbound(tx, historical, {
      sourceKey: `PRODUCTION-CONSUMPTION-COST:${line.id}`,
      itemId: line.itemId,
      inventoryMovementId: movement.id,
      entryType:
        document.materialType === "RAW_MATERIAL"
          ? "PRODUCTION_CONSUMPTION"
          : "PACKAGING_CONSUMPTION",
      effectiveAt: movement.postedAt,
      sourceType: "PRODUCTION_MATERIAL_TRANSACTION",
      sourceId: document.id,
      sourceNumber: document.transactionNumber,
      productionBatchId: document.productionBatchId,
      inventoryLotId: line.inventoryLotId,
      actorUserId,
      quantity: line.normalizedQuantity.toString(),
    });
  }
}

export async function valueSalesInvoiceOutflow(
  tx: Prisma.TransactionClient,
  salesInvoiceId: string,
  actorUserId: string,
  historical = false,
) {
  const invoice = await tx.salesInvoice.findUnique({
    where: { id: salesInvoiceId },
    include: {
      lines: {
        include: { allocations: { orderBy: { id: "asc" } } },
        orderBy: { id: "asc" },
      },
    },
  });
  if (!invoice) throw new CostingRepositoryError("Sales invoice costing source is missing.");
  for (const line of invoice.lines)
    for (const allocation of line.allocations) {
      const movement = await tx.inventoryMovement.findUnique({
        where: {
          sourceKey_movementType: {
            sourceKey: `SI:${allocation.id}:OUT`,
            movementType: "SALES_INVOICE_OUT",
          },
        },
      });
      if (!movement) throw new CostingRepositoryError("Sales-out inventory provenance is missing.");
      await postOutbound(tx, historical, {
        sourceKey: `SALES-OUT-COST:${allocation.id}`,
        itemId: line.itemId,
        inventoryMovementId: movement.id,
        entryType: "SALES_OUT",
        effectiveAt: movement.postedAt,
        sourceType: "SALES_INVOICE",
        sourceId: invoice.id,
        sourceNumber: invoice.number,
        productionLotId: allocation.productionLotId,
        actorUserId,
        quantity: allocation.quantity.toString(),
      });
    }
}

export async function valueSalesReturnReceipt(
  tx: Prisma.TransactionClient,
  salesReturnId: string,
  actorUserId: string,
) {
  const document = await tx.salesReturn.findUnique({
    where: { id: salesReturnId },
    include: { lines: true },
  });
  if (!document || document.type !== "INVOICED_RETURN") return;
  for (const line of document.lines) {
    const movement = await tx.inventoryMovement.findFirst({
      where: {
        salesReturnLineId: line.id,
        movementType: "SALES_RETURN_RECEIPT",
        quantity: { gt: 0 },
      },
    });
    const source = await tx.inventoryValuationEntry.findFirst({
      where: {
        entryType: "SALES_OUT",
        itemId: line.itemId,
        productionLotId: line.productionLotId,
        inventoryMovement: { salesInvoiceLineId: line.salesInvoiceLineId },
      },
      orderBy: [{ effectiveAt: "desc" }, { id: "desc" }],
    });
    if (!movement)
      throw new CostingRepositoryError("Sales-return inventory provenance is missing.");
    if (!source?.unitCost) {
      await postMissingValuationBasis(tx, {
        sourceKey: `SALES-RETURN-COST:${line.id}`,
        itemId: line.itemId,
        inventoryMovementId: movement.id,
        entryType: "SALES_RETURN",
        effectiveAt: movement.postedAt,
        sourceType: "SALES_RETURN",
        sourceId: document.id,
        sourceNumber: document.number,
        productionLotId: line.productionLotId,
        actorUserId,
        quantity: line.totalPieces.toString(),
        reasonCode: "MISSING_SOURCE_SALES_COST",
        description: "The original sales inventory-out cost basis has not been resolved.",
      });
    } else
      await postValuedInbound(tx, {
        sourceKey: `SALES-RETURN-COST:${line.id}`,
        itemId: line.itemId,
        inventoryMovementId: movement.id,
        entryType: "SALES_RETURN",
        effectiveAt: movement.postedAt,
        sourceType: "SALES_RETURN",
        sourceId: document.id,
        sourceNumber: document.number,
        productionLotId: line.productionLotId,
        actorUserId,
        quantity: line.totalPieces.toString(),
        unitCost: source.unitCost.toString(),
        notes: "Original sales inventory-out cost basis restored.",
      });
  }
}

export async function valueManualInventoryMovement(
  tx: Prisma.TransactionClient,
  movementId: string,
  unitCost: string | undefined,
  actorUserId: string,
  historical = false,
) {
  const movement = await tx.inventoryMovement.findUniqueOrThrow({ where: { id: movementId } });
  const type = movement.movementType;
  const common = {
    sourceKey: `MANUAL-COST:${movement.id}`,
    itemId: movement.itemId,
    inventoryMovementId: movement.id,
    effectiveAt: movement.postedAt,
    sourceType: movement.referenceType,
    sourceId: movement.referenceId ?? movement.id,
    notes: movement.reason,
    actorUserId,
  };
  if (type === "ADJUSTMENT_OUT")
    await postOutbound(tx, historical, {
      ...common,
      entryType: "ADJUSTMENT_OUT",
      quantity: movement.quantity.abs().toString(),
    });
  else if (type === "OPENING_BALANCE" || type === "ADJUSTMENT_IN") {
    const entryType = type === "OPENING_BALANCE" ? "OPENING_BALANCE" : "ADJUSTMENT_IN";
    if (unitCost !== undefined)
      await postValuedInbound(tx, {
        ...common,
        entryType,
        quantity: movement.quantity.toString(),
        unitCost,
      });
    else
      await postMissingValuationBasis(tx, {
        ...common,
        entryType,
        quantity: movement.quantity.toString(),
        reasonCode: "MISSING_VALUATION_BASIS",
        description: `${type.replaceAll("_", " ")} has no reliable historical unit cost.`,
      });
  }
}

async function postOutbound(
  tx: Prisma.TransactionClient,
  historical: boolean,
  command: Parameters<typeof postValuedOutbound>[1],
) {
  try {
    await postValuedOutbound(tx, command);
  } catch (error) {
    if (
      !historical ||
      !(error instanceof InventoryValuationError) ||
      error.reason !== "missing-basis"
    )
      throw error;
    await postHistoricalUnvaluedOutbound(tx, command);
  }
}

async function rebuildValuation(tx: Prisma.TransactionClient, actorUserId: string) {
  const movements = await tx.inventoryMovement.findMany({
    where: {
      movementType: {
        in: [
          "OPENING_BALANCE",
          "ADJUSTMENT_IN",
          "ADJUSTMENT_OUT",
          "PURCHASE_RECEIPT",
          "PURCHASE_RETURN",
          "PRODUCTION_CONSUMPTION",
          "PACKAGING_CONSUMPTION",
          "PRODUCTION_OUTPUT",
          "SALES_INVOICE_OUT",
          "SALES_RETURN_RECEIPT",
        ],
      },
    },
    orderBy: [{ postedAt: "asc" }, { id: "asc" }],
  });
  const entriesBefore = await tx.inventoryValuationEntry.count();
  const documents = new Set<string>();
  for (const movement of movements) {
    if (["OPENING_BALANCE", "ADJUSTMENT_IN", "ADJUSTMENT_OUT"].includes(movement.movementType))
      await valueManualInventoryMovement(tx, movement.id, undefined, actorUserId, true);
    else if (
      movement.movementType === "PURCHASE_RECEIPT" &&
      movement.referenceId &&
      !documents.has(`GRN:${movement.referenceId}`)
    ) {
      documents.add(`GRN:${movement.referenceId}`);
      await valueGoodsReceipt(tx, movement.referenceId, actorUserId);
    } else if (
      movement.movementType === "PURCHASE_RETURN" &&
      movement.referenceId &&
      !documents.has(`PR:${movement.referenceId}`)
    ) {
      documents.add(`PR:${movement.referenceId}`);
      await valuePurchaseReturn(tx, movement.referenceId, actorUserId, true);
    } else if (
      ["PRODUCTION_CONSUMPTION", "PACKAGING_CONSUMPTION"].includes(movement.movementType) &&
      movement.productionMaterialTransactionLineId
    ) {
      const line = await tx.productionMaterialTransactionLine.findUnique({
        where: { id: movement.productionMaterialTransactionLineId },
        select: { transactionId: true },
      });
      if (line && !documents.has(`PMT:${line.transactionId}`)) {
        documents.add(`PMT:${line.transactionId}`);
        await valueProductionConsumption(tx, line.transactionId, actorUserId, true);
      }
    } else if (
      movement.movementType === "SALES_INVOICE_OUT" &&
      movement.salesInvoiceId &&
      !documents.has(`SI:${movement.salesInvoiceId}`)
    ) {
      documents.add(`SI:${movement.salesInvoiceId}`);
      await valueSalesInvoiceOutflow(tx, movement.salesInvoiceId, actorUserId, true);
    } else if (
      movement.movementType === "SALES_RETURN_RECEIPT" &&
      movement.salesReturnId &&
      !documents.has(`SR:${movement.salesReturnId}`)
    ) {
      documents.add(`SR:${movement.salesReturnId}`);
      await valueSalesReturnReceipt(tx, movement.salesReturnId, actorUserId);
    } else if (
      movement.movementType === "PRODUCTION_OUTPUT" &&
      movement.productionOutputTransactionId
    ) {
      const output = await tx.productionOutputTransaction.findUnique({
        where: { id: movement.productionOutputTransactionId },
        include: {
          productionBatch: { include: { productionCostSnapshot: true } },
          productionLot: true,
        },
      });
      const snapshot = output?.productionBatch.productionCostSnapshot;
      if (output?.outputType === "GOOD" && snapshot && output.productionLot)
        await postValuedInbound(tx, {
          sourceKey: `PRODUCTION-OUTPUT:${output.id}`,
          itemId: movement.itemId,
          inventoryMovementId: movement.id,
          entryType: "PRODUCTION_OUTPUT",
          effectiveAt: movement.postedAt,
          sourceType: "PRODUCTION_OUTPUT",
          sourceId: output.id,
          sourceNumber: output.outputNumber,
          productionBatchId: output.productionBatchId,
          productionLotId: output.productionLot.id,
          notes: `Finalized batch cost ${snapshot.id}.`,
          actorUserId,
          quantity: movement.quantity.toString(),
          unitCost: snapshot.costPerPiece.toString(),
        });
    }
  }
  return {
    processed: (await tx.inventoryValuationEntry.count()) - entriesBefore,
    unresolved: await tx.inventoryValuationIssue.count({ where: { resolvedAt: null } }),
  };
}

async function batchCosting(client: Client, batchId: string) {
  const batch = await client.productionBatch.findUnique({
    where: { id: batchId },
    include: {
      finishedGood: { include: { finishedGoodProfile: true } },
      productionLot: true,
      materialRequirements: { include: { item: true } },
      packagingRequirements: { include: { item: true } },
      productionCostEntries: { include: { createdBy: true }, orderBy: { createdAt: "asc" } },
      productionCostSnapshot: { include: { finalizedBy: true } },
      outputTransactions: { where: { status: "POSTED" } },
      materialTransactions: {
        where: { status: "POSTED" },
        include: { lines: { include: { item: true } } },
      },
    },
  });
  if (!batch || !batch.finishedGood.finishedGoodProfile) return null;
  const valuations = await client.inventoryValuationEntry.findMany({
    where: {
      productionBatchId: batch.id,
      entryType: { in: ["PRODUCTION_CONSUMPTION", "PACKAGING_CONSUMPTION"] },
    },
  });
  const raw = costLines(
    batch.materialTransactions.filter(
      (row) => row.materialType === "RAW_MATERIAL" && row.transactionType === "CONSUMPTION",
    ),
    valuations,
    batch.materialRequirements.map((row) => ({
      itemId: row.itemId,
      planned: row.plannedNormalizedQuantity.toString(),
    })),
  );
  const packaging = costLines(
    batch.materialTransactions.filter(
      (row) => row.materialType === "PACKAGING_MATERIAL" && row.transactionType === "CONSUMPTION",
    ),
    valuations,
    batch.packagingRequirements.map((row) => ({
      itemId: row.itemId,
      planned: row.standardRequiredQuantity.toString(),
    })),
  );
  const damageTransactions = batch.materialTransactions.filter(
    (row) => row.materialType === "PACKAGING_MATERIAL" && row.transactionType === "DAMAGE",
  );
  const damagedPackaging = await Promise.all(
    damageTransactions
      .flatMap((row) => row.lines)
      .map(async (line) => {
        const balance = await client.inventoryValuationBalance.findUnique({
          where: { itemId: line.itemId },
        });
        const unit =
          balance?.missingBasisCount === 0 ? (balance.averageUnitCost?.toString() ?? null) : null;
        return {
          itemCode: line.item.code,
          itemName: line.item.name,
          quantity: line.normalizedQuantity.toString(),
          unitCost: unit,
          totalCost: unit
            ? money(new Decimal(unit).mul(line.normalizedQuantity.toString())).toFixed(6)
            : null,
          plannedQuantity: null,
        };
      }),
  );
  const warnings: string[] = [];
  if (raw.some((line) => line.totalCost === null))
    warnings.push("Raw-material consumption has missing valuation basis.");
  if (packaging.some((line) => line.totalCost === null))
    warnings.push("Packaging consumption has missing valuation basis.");
  const goodPieces = sum(
    batch.outputTransactions
      .filter((row) => row.outputType === "GOOD")
      .map((row) => row.totalPieces?.toString() ?? "0"),
  );
  if (goodPieces.lte(0)) warnings.push("Actual posted good output must be greater than zero.");
  if (!batch.productionLot) warnings.push("Finished production lot is missing.");
  const rawCost = nullableSum(raw.map((line) => line.totalCost));
  const packagingCost = nullableSum(packaging.map((line) => line.totalCost));
  const additional = sum(
    batch.productionCostEntries
      .filter((row) => row.category !== "COST_CREDIT")
      .map((row) => row.amount.toString()),
  );
  const credits = sum(
    batch.productionCostEntries
      .filter((row) => row.category === "COST_CREDIT")
      .map((row) => row.amount.toString()),
  );
  const damagedExposure = nullableSum(damagedPackaging.map((line) => line.totalCost));
  const pool =
    rawCost && packagingCost
      ? money(rawCost.add(packagingCost).add(additional).sub(credits))
      : null;
  if (pool?.lt(0)) warnings.push("Cost credits exceed capitalizable manufacturing cost.");
  const costPerPiece = pool && pool.gte(0) && goodPieces.gt(0) ? unit(pool.div(goodPieces)) : null;
  const abnormal = sum(
    batch.outputTransactions
      .filter((row) => row.outputType === "PROCESS_LOSS" && row.lossNature === "ABNORMAL")
      .map((row) => row.normalizedQuantity?.toString() ?? "0"),
  );
  const snapshot = batch.productionCostSnapshot;
  return {
    batchId: batch.id,
    batchNumber: batch.batchNumber,
    batchStatus: batch.status,
    costingStatus: snapshot
      ? ("FINALIZED" as const)
      : warnings.length
        ? ("UNCOSTED" as const)
        : ("PROVISIONAL" as const),
    finishedGoodCode: batch.finishedGood.code,
    finishedGoodName: batch.finishedGood.name,
    piecesPerCarton: batch.finishedGood.finishedGoodProfile.piecesPerCarton,
    rawMaterials: raw,
    packaging,
    damagedPackaging,
    manualEntries: batch.productionCostEntries.map((row) => ({
      id: row.id,
      category: row.category,
      amount: row.amount.toString(),
      description: row.description,
      reference: row.reference,
      createdByName: row.createdBy.name,
    })),
    rawMaterialCost: snapshot?.rawMaterialCost.toString() ?? rawCost?.toFixed(6) ?? null,
    packagingCost: snapshot?.packagingCost.toString() ?? packagingCost?.toFixed(6) ?? null,
    additionalCost: snapshot?.additionalCost.toString() ?? additional.toFixed(6),
    costCredits: snapshot?.costCredits.toString() ?? credits.toFixed(6),
    damagedPackagingExposure:
      snapshot?.damagedPackagingExposure.toString() ?? damagedExposure?.toFixed(6) ?? null,
    finishedGoodsCostPool: snapshot?.finishedGoodsCostPool.toString() ?? pool?.toFixed(6) ?? null,
    actualGoodPieces: snapshot?.actualGoodPieces.toString() ?? goodPieces.toFixed(6),
    costPerPiece: snapshot?.costPerPiece.toString() ?? costPerPiece?.toFixed(12) ?? null,
    costPerCarton:
      (snapshot?.costPerPiece ? new Decimal(snapshot.costPerPiece.toString()) : costPerPiece)
        ?.mul(batch.finishedGood.finishedGoodProfile.piecesPerCarton)
        .toFixed(6) ?? null,
    abnormalLossQuantity: abnormal.toFixed(6),
    warnings,
    finalizedAt: snapshot?.finalizedAt ?? null,
    finalizedByName: snapshot?.finalizedBy.name ?? null,
  };
}

type CostLineTransaction = {
  id: string;
  lines: readonly {
    id: string;
    itemId: string;
    normalizedQuantity: Prisma.Decimal;
    item: { code: string; name: string };
  }[];
};

type CostLineValuation = {
  sourceKey: string;
  inventoryMovementId: string | null;
  itemId: string;
  sourceId: string | null;
  unitCost: Prisma.Decimal | null;
  valueDelta: Prisma.Decimal | null;
};

function costLines(
  transactions: readonly CostLineTransaction[],
  valuations: readonly CostLineValuation[],
  planned: readonly { itemId: string; planned: string }[],
) {
  return transactions.flatMap((row) =>
    row.lines.map((line) => {
      const valuation = valuations.find(
        (entry) =>
          entry.itemId === line.itemId &&
          entry.sourceId === row.id &&
          entry.sourceKey === `PRODUCTION-CONSUMPTION-COST:${line.id}`,
      );
      return {
        itemCode: line.item.code,
        itemName: line.item.name,
        quantity: line.normalizedQuantity.toString(),
        unitCost: valuation?.unitCost?.toString() ?? null,
        totalCost: valuation?.valueDelta
          ? new Decimal(valuation.valueDelta.toString()).abs().toFixed(6)
          : null,
        plannedQuantity: planned.find((entry) => entry.itemId === line.itemId)?.planned ?? null,
      };
    }),
  );
}

function purchaseBaseValue(
  line: {
    normalizedQuantity: Prisma.Decimal;
    grossAmount: Prisma.Decimal;
    discountAmount: Prisma.Decimal;
  },
  receiptQuantity: string,
) {
  const ordered = new Decimal(line.normalizedQuantity.toString());
  if (ordered.lte(0))
    throw new CostingRepositoryError("Purchase line has invalid canonical quantity.");
  const unitCost = new Decimal(line.grossAmount.toString())
    .sub(line.discountAmount.toString())
    .div(ordered);
  return { unitCost: unit(unitCost), value: money(unitCost.mul(receiptQuantity)) };
}
function summary(
  item: {
    id: string;
    code: string;
    name: string;
    itemType: ItemType;
    active: boolean;
    category: { name: string };
    stockUnit: { symbol: string };
    finishedGoodProfile: { piecesPerCarton: number } | null;
    inventoryValuationBalance: {
      missingBasisCount: number;
      averageUnitCost: Prisma.Decimal | null;
      inventoryValue: Prisma.Decimal;
      lastValuationAt: Date | null;
    } | null;
  },
  physical: string,
) {
  const balance = item.inventoryValuationBalance;
  return {
    itemId: item.id,
    itemCode: item.code,
    itemName: item.name,
    itemType: item.itemType,
    categoryName: item.category.name,
    active: item.active,
    canonicalUnitSymbol: item.stockUnit.symbol,
    canonicalQuantity: physical,
    averageUnitCost:
      balance?.missingBasisCount === 0 ? (balance.averageUnitCost?.toString() ?? null) : null,
    inventoryValue: balance?.inventoryValue.toString() ?? "0",
    missingBasisCount: balance?.missingBasisCount ?? 0,
    lastValuationAt: balance?.lastValuationAt ?? null,
    piecesPerCarton: item.finishedGoodProfile?.piecesPerCarton ?? null,
  };
}
async function adjustmentNumber(tx: Prisma.TransactionClient, year: number) {
  const row = await tx.inventoryValuationAdjustmentSequence.upsert({
    where: { year },
    create: { year, nextValue: 2 },
    update: { nextValue: { increment: 1 } },
  });
  return `VA-${year}-${String(row.nextValue - 1).padStart(6, "0")}`;
}
async function landedCostNumber(tx: Prisma.TransactionClient, year: number) {
  const row = await tx.landedCostSequence.upsert({
    where: { year },
    create: { year, nextValue: 2 },
    update: { nextValue: { increment: 1 } },
  });
  return `LC-${year}-${String(row.nextValue - 1).padStart(6, "0")}`;
}
function sum(values: readonly string[]) {
  return values.reduce((total, value) => total.add(value), new Decimal(0));
}
function nullableSum(values: readonly (string | null)[]) {
  return values.some((value) => value === null) ? null : sum(values as string[]);
}
function money(value: Decimal) {
  return value.toDecimalPlaces(6, Decimal.ROUND_HALF_UP);
}
function unit(value: Decimal) {
  return value.toDecimalPlaces(12, Decimal.ROUND_HALF_UP);
}
async function serializable<T>(operation: (tx: Prisma.TransactionClient) => Promise<T>) {
  for (let attempt = 1; attempt <= 3; attempt += 1)
    try {
      return await prisma.$transaction(operation, { isolationLevel: "Serializable" });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2034" &&
        attempt < 3
      )
        continue;
      if (error instanceof InventoryValuationError || error instanceof CostingRepositoryError)
        throw error;
      throw error instanceof Error
        ? error
        : new CostingRepositoryError("Costing transaction failed.");
    }
  throw new CostingRepositoryError("Costing transaction conflict; retry.");
}
