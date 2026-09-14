import "server-only";

import Decimal from "decimal.js";
import { Prisma } from "@/generated/prisma/client";

import type {
  WasteDispositionDraftInput,
  WasteDispositionLineInput,
  WasteDispositionRepository,
} from "@/modules/inventory/application/waste-disposition-contracts";
import { WasteDispositionRepositoryError } from "@/modules/inventory/application/waste-disposition-contracts";
import {
  validateWasteDispositionLine,
  validateWasteReversal,
} from "@/modules/inventory/domain/waste-disposition";
import { recordAuditEvent } from "@/server/audit/audit-event";
import {
  valueWasteWriteOff,
  valueWasteWriteOffReversal,
} from "@/server/costing/prisma-inventory-valuation-repository";
import { prisma } from "@/server/db/prisma";
import {
  postWasteDispositionInventory,
  postWasteDispositionReversalInventory,
} from "./transactional-inventory-posting";

export class PrismaWasteDispositionRepository implements WasteDispositionRepository {
  async listDocuments() {
    return prisma.wasteDisposition.findMany({
      include: {
        warehouse: true,
        createdBy: true,
        postedBy: true,
        reversal: true,
        lines: { select: { id: true, action: true, enteredQuantity: true } },
      },
      orderBy: [{ dispositionDate: "desc" }, { documentNumber: "desc" }],
      take: 200,
    });
  }

  async getDocument(id: string) {
    return prisma.wasteDisposition.findUnique({
      where: { id },
      include: {
        warehouse: true,
        createdBy: true,
        postedBy: true,
        cancelledBy: true,
        reversedBy: true,
        reversalOf: true,
        reversal: true,
        lines: {
          include: {
            item: true,
            inventoryLot: true,
            productionLot: true,
            canonicalUnit: true,
            inventoryMovements: { orderBy: { postedAt: "asc" } },
            reprocessSourceContributions: {
              include: {
                reprocessDocument: {
                  include: { childProductionLot: true, qcDecision: true },
                },
              },
            },
          },
          orderBy: { position: "asc" },
        },
      },
    });
  }

  async listSourceOptions() {
    const balances = await prisma.inventoryMovement.groupBy({
      by: [
        "itemId",
        "warehouseId",
        "inventoryLotId",
        "productionLotId",
        "canonicalUnitId",
        "status",
      ],
      where: { status: { in: ["DAMAGED", "QUARANTINE", "SCRAP"] } },
      _sum: { quantity: true },
    });
    const positive = balances.filter((row) =>
      new Decimal(row._sum.quantity?.toString() ?? "0").gt(0),
    );
    const [items, warehouses, units, inventoryLots, productionLots] = await Promise.all([
      prisma.item.findMany({ where: { id: { in: positive.map((row) => row.itemId) } } }),
      prisma.warehouse.findMany({ where: { id: { in: positive.map((row) => row.warehouseId) } } }),
      prisma.unit.findMany({ where: { id: { in: positive.map((row) => row.canonicalUnitId) } } }),
      prisma.inventoryLot.findMany({
        where: {
          id: { in: positive.flatMap((row) => (row.inventoryLotId ? [row.inventoryLotId] : [])) },
        },
      }),
      prisma.productionLot.findMany({
        where: {
          id: { in: positive.flatMap((row) => (row.productionLotId ? [row.productionLotId] : [])) },
        },
      }),
    ]);
    return positive.flatMap((row) => {
      const item = items.find((candidate) => candidate.id === row.itemId);
      const warehouse = warehouses.find((candidate) => candidate.id === row.warehouseId);
      const unit = units.find((candidate) => candidate.id === row.canonicalUnitId);
      const lotNumber = row.productionLotId
        ? productionLots.find((lot) => lot.id === row.productionLotId)?.lotNumber
        : inventoryLots.find((lot) => lot.id === row.inventoryLotId)?.supplierLotNumber;
      return item && warehouse && unit
        ? [
            {
              itemId: item.id,
              itemType: item.itemType,
              itemCode: item.code,
              itemName: item.name,
              warehouseId: warehouse.id,
              warehouseCode: warehouse.code,
              inventoryLotId: row.inventoryLotId,
              productionLotId: row.productionLotId,
              lotNumber: lotNumber ?? "Unnumbered lot",
              unitId: unit.id,
              unitSymbol: unit.symbol,
              sourceStatus: row.status as "DAMAGED" | "QUARANTINE" | "SCRAP",
              quantity: row._sum.quantity!.toString(),
            },
          ]
        : [];
    });
  }

  async saveDraft(input: WasteDispositionDraftInput) {
    return serializable(async (tx) => {
      await requireInventoryAuthority(tx, input.actorUserId);
      const date = utcDate(input.dispositionDate);
      const warehouse = await tx.warehouse.findFirst({
        where: { id: input.warehouseId, active: true },
      });
      if (!warehouse)
        throw new WasteDispositionRepositoryError(
          "invalid-reference",
          "Select an active disposition warehouse.",
        );
      const lines = [];
      for (const [index, inputLine] of input.lines.entries())
        lines.push(await prepareLine(tx, inputLine, input.warehouseId, date, index + 1));
      if (input.id) {
        const existing = await tx.wasteDisposition.findUnique({ where: { id: input.id } });
        if (!existing)
          throw new WasteDispositionRepositoryError("not-found", "Disposition was not found.");
        if (existing.status !== "DRAFT")
          throw new WasteDispositionRepositoryError(
            "invalid-state",
            "Only a DRAFT disposition can be edited.",
          );
        await tx.wasteDispositionLine.deleteMany({ where: { wasteDispositionId: existing.id } });
        await tx.wasteDisposition.update({
          where: { id: existing.id },
          data: {
            dispositionDate: date,
            warehouseId: input.warehouseId,
            notes: input.notes ?? null,
            lines: { create: lines },
          },
        });
        await recordAuditEvent(tx, {
          actorUserId: input.actorUserId,
          action: "UPDATE",
          entityType: "WASTE_DISPOSITION",
          entityId: existing.id,
          entityReference: existing.documentNumber,
          module: "inventory",
          description: `Updated disposition draft ${existing.documentNumber}.`,
          afterSnapshot: { status: "DRAFT", lineCount: lines.length },
          controlEvent: true,
        });
        return existing.id;
      }
      const documentNumber = await nextDocumentNumber(tx, date.getUTCFullYear());
      const document = await tx.wasteDisposition.create({
        data: {
          documentNumber,
          dispositionDate: date,
          warehouseId: input.warehouseId,
          notes: input.notes ?? null,
          createdByUserId: input.actorUserId,
          lines: { create: lines },
        },
      });
      await recordAuditEvent(tx, {
        actorUserId: input.actorUserId,
        action: "CREATE",
        entityType: "WASTE_DISPOSITION",
        entityId: document.id,
        entityReference: documentNumber,
        module: "inventory",
        description: `Created disposition draft ${documentNumber}.`,
        afterSnapshot: { status: "DRAFT", lineCount: lines.length },
        controlEvent: true,
      });
      return document.id;
    });
  }

  async post(id: string, actorUserId: string) {
    await serializable(async (tx) => {
      await requireInventoryAuthority(tx, actorUserId);
      const document = await tx.wasteDisposition.findUnique({
        where: { id },
        include: { lines: { orderBy: { position: "asc" } } },
      });
      if (!document)
        throw new WasteDispositionRepositoryError("not-found", "Disposition was not found.");
      if (document.status !== "DRAFT")
        throw new WasteDispositionRepositoryError(
          "invalid-state",
          "Only a DRAFT disposition can be posted.",
        );
      if (!document.lines.length)
        throw new WasteDispositionRepositoryError(
          "invalid-state",
          "Add at least one disposition line before posting.",
        );
      for (const line of document.lines) {
        const prepared = await prepareLine(
          tx,
          {
            itemId: line.itemId,
            inventoryLotId: line.inventoryLotId ?? undefined,
            productionLotId: line.productionLotId ?? undefined,
            sourceStatus: line.sourceStatus as WasteDispositionLineInput["sourceStatus"],
            quantity: line.enteredQuantity.toString(),
            unitId: line.canonicalUnitId,
            action: line.action,
            reason: line.reason,
            notes: line.notes ?? undefined,
          },
          document.warehouseId,
          document.dispositionDate,
          line.position,
        );
        const movement = await postWasteDispositionInventory(tx, {
          dispositionId: document.id,
          documentNumber: document.documentNumber,
          lineId: line.id,
          itemId: line.itemId,
          warehouseId: line.warehouseId,
          inventoryLotId: line.inventoryLotId ?? undefined,
          productionLotId: line.productionLotId ?? undefined,
          canonicalUnitId: line.canonicalUnitId,
          sourceStatus: line.sourceStatus as "DAMAGED" | "QUARANTINE" | "SCRAP",
          action: line.action,
          quantity: prepared.enteredQuantity,
          reason: `${line.action}: ${line.reason}${line.notes ? ` — ${line.notes}` : ""}`,
          actorUserId,
        });
        if (line.action === "WRITE_OFF") {
          const { valuation, accountingJournalId } = await valueWasteWriteOff(
            tx,
            line.id,
            actorUserId,
          );
          await tx.wasteDispositionLine.update({
            where: { id: line.id },
            data: {
              originalValuationEntryId: valuation.id,
              originalAccountingJournalId: accountingJournalId,
              originalValue: valuation.valueDelta?.abs() ?? "0",
              originalUnitCost: valuation.unitCost,
            },
          });
        }
        if (!movement)
          throw new WasteDispositionRepositoryError(
            "conflict",
            "Disposition inventory posting did not complete.",
          );
      }
      const now = new Date();
      await tx.wasteDisposition.update({
        where: { id },
        data: { status: "POSTED", postedByUserId: actorUserId, postedAt: now },
      });
      await recordAuditEvent(tx, {
        actorUserId,
        action: "POST",
        entityType: "WASTE_DISPOSITION",
        entityId: id,
        entityReference: document.documentNumber,
        module: "inventory",
        description: `Posted controlled disposition ${document.documentNumber}.`,
        metadata: {
          lines: document.lines.map((line) => ({
            lineId: line.id,
            itemId: line.itemId,
            inventoryLotId: line.inventoryLotId,
            productionLotId: line.productionLotId,
            sourceStatus: line.sourceStatus,
            action: line.action,
            reason: line.reason,
            quantity: line.enteredQuantity.toString(),
          })),
        },
        beforeSnapshot: { status: "DRAFT" },
        afterSnapshot: { status: "POSTED", postedAt: now.toISOString() },
        controlEvent: true,
      });
    });
  }

  async cancel(id: string, actorUserId: string, reason: string) {
    await serializable(async (tx) => {
      await requireInventoryAuthority(tx, actorUserId);
      const document = await tx.wasteDisposition.findUnique({ where: { id } });
      if (!document)
        throw new WasteDispositionRepositoryError("not-found", "Disposition was not found.");
      if (document.status !== "DRAFT")
        throw new WasteDispositionRepositoryError(
          "invalid-state",
          "Only a DRAFT disposition can be cancelled.",
        );
      await tx.wasteDisposition.update({
        where: { id },
        data: {
          status: "CANCELLED",
          cancelledByUserId: actorUserId,
          cancelledAt: new Date(),
          cancellationReason: reason,
        },
      });
      await recordAuditEvent(tx, {
        actorUserId,
        action: "CANCEL",
        entityType: "WASTE_DISPOSITION",
        entityId: id,
        entityReference: document.documentNumber,
        module: "inventory",
        description: `Cancelled disposition ${document.documentNumber}.`,
        reason,
        beforeSnapshot: { status: "DRAFT" },
        afterSnapshot: { status: "CANCELLED" },
        controlEvent: true,
      });
    });
  }

  async reverse(id: string, actorUserId: string, reason: string): Promise<string> {
    return serializable(async (tx) => {
      await requireInventoryAuthority(tx, actorUserId);
      const original = await tx.wasteDisposition.findUnique({
        where: { id },
        include: { lines: { orderBy: { position: "asc" } }, reversal: true },
      });
      if (!original)
        throw new WasteDispositionRepositoryError("not-found", "Disposition was not found.");
      if (original.status !== "POSTED" || original.reversal)
        throw new WasteDispositionRepositoryError(
          "invalid-state",
          "Only an unreversed POSTED disposition can be reversed.",
        );
      for (const line of original.lines) {
        const destinationStatus =
          line.action === "MOVE_TO_SCRAP"
            ? "SCRAP"
            : line.action === "MOVE_TO_REPROCESS"
              ? "REPROCESS"
              : null;
        const [balance, downstreamReprocessClaims, downstreamDispositionClaims] = await Promise.all(
          [
            destinationStatus
              ? tx.inventoryMovement.aggregate({
                  where: {
                    itemId: line.itemId,
                    warehouseId: line.warehouseId,
                    canonicalUnitId: line.canonicalUnitId,
                    status: destinationStatus,
                    inventoryLotId: line.inventoryLotId,
                    productionLotId: line.productionLotId,
                  },
                  _sum: { quantity: true },
                })
              : Promise.resolve({ _sum: { quantity: new Prisma.Decimal(0) } }),
            line.action === "MOVE_TO_REPROCESS"
              ? tx.reprocessSourceContribution.count({
                  where: { sourceWasteDispositionLineId: line.id },
                })
              : Promise.resolve(0),
            destinationStatus
              ? tx.wasteDispositionLine.count({
                  where: {
                    wasteDispositionId: { not: original.id },
                    itemId: line.itemId,
                    warehouseId: line.warehouseId,
                    inventoryLotId: line.inventoryLotId,
                    productionLotId: line.productionLotId,
                    sourceStatus: destinationStatus,
                    disposition: {
                      status: { in: ["POSTED", "REVERSED"] },
                      postedAt: { gt: original.postedAt! },
                    },
                  },
                })
              : Promise.resolve(0),
          ],
        );
        validateWasteReversal({
          action: line.action,
          quantity: line.enteredQuantity.toString(),
          destinationBalance: balance._sum.quantity?.toString() ?? "0",
          downstreamReprocessClaims,
          downstreamDispositionClaims,
          originalValue: line.originalValue?.toString(),
          originalUnitCost: line.originalUnitCost?.toString(),
        });
      }
      const reversalDate = utcDate(new Date().toISOString().slice(0, 10));
      const documentNumber = await nextDocumentNumber(tx, reversalDate.getUTCFullYear());
      const reversal = await tx.wasteDisposition.create({
        data: {
          documentNumber,
          dispositionDate: reversalDate,
          warehouseId: original.warehouseId,
          status: "DRAFT",
          notes: `Reversal of ${original.documentNumber}: ${reason}`,
          createdByUserId: actorUserId,
          reversalOfId: original.id,
          lines: {
            create: original.lines.map((line) => ({
              position: line.position,
              itemId: line.itemId,
              warehouseId: line.warehouseId,
              inventoryLotId: line.inventoryLotId,
              productionLotId: line.productionLotId,
              sourceStatus: line.sourceStatus,
              enteredQuantity: line.enteredQuantity,
              canonicalUnitId: line.canonicalUnitId,
              canonicalUnitDimension: line.canonicalUnitDimension,
              action: line.action,
              reason: line.reason,
              notes: line.notes,
              originalValuationEntryId: line.originalValuationEntryId,
              originalAccountingJournalId: line.originalAccountingJournalId,
              originalValue: line.originalValue,
              originalUnitCost: line.originalUnitCost,
            })),
          },
        },
        include: { lines: { orderBy: { position: "asc" } } },
      });
      for (const [index, line] of original.lines.entries()) {
        const reversalLine = reversal.lines[index]!;
        await postWasteDispositionReversalInventory(tx, {
          dispositionId: reversal.id,
          documentNumber: reversal.documentNumber,
          lineId: reversalLine.id,
          itemId: line.itemId,
          warehouseId: line.warehouseId,
          inventoryLotId: line.inventoryLotId ?? undefined,
          productionLotId: line.productionLotId ?? undefined,
          canonicalUnitId: line.canonicalUnitId,
          sourceStatus: line.sourceStatus as "DAMAGED" | "QUARANTINE" | "SCRAP",
          originalSourceStatus: line.sourceStatus as "DAMAGED" | "QUARANTINE" | "SCRAP",
          action: line.action,
          quantity: line.enteredQuantity.toString(),
          reason: `Reversal of ${original.documentNumber}: ${reason}`,
          actorUserId,
        });
        if (line.action === "WRITE_OFF")
          await valueWasteWriteOffReversal(tx, line.id, reversalLine.id, actorUserId);
      }
      const now = new Date();
      await tx.wasteDisposition.update({
        where: { id: reversal.id },
        data: { status: "POSTED", postedByUserId: actorUserId, postedAt: now },
      });
      await tx.wasteDisposition.update({
        where: { id: original.id },
        data: {
          status: "REVERSED",
          reversedByUserId: actorUserId,
          reversedAt: now,
          reversalReason: reason,
        },
      });
      await recordAuditEvent(tx, {
        actorUserId,
        action: "REVERSE",
        entityType: "WASTE_DISPOSITION",
        entityId: original.id,
        entityReference: original.documentNumber,
        module: "inventory",
        description: `Reversed controlled disposition ${original.documentNumber}.`,
        reason,
        beforeSnapshot: { status: "POSTED" },
        afterSnapshot: { status: "REVERSED", reversalId: reversal.id },
        related: {
          entityType: "WASTE_DISPOSITION",
          entityId: reversal.id,
          reference: reversal.documentNumber,
        },
        controlEvent: true,
      });
      return reversal.id;
    });
  }
}

async function prepareLine(
  tx: Prisma.TransactionClient,
  line: WasteDispositionLineInput,
  warehouseId: string,
  dispositionDate: Date,
  position: number,
) {
  const item = await tx.item.findFirst({
    where: { id: line.itemId, active: true },
    include: { stockUnit: true, finishedGoodProfile: true },
  });
  if (!item || item.stockUnitId !== line.unitId)
    throw new WasteDispositionRepositoryError(
      "invalid-reference",
      "Disposition item or authoritative stock unit is invalid.",
    );
  const [inventoryLot, productionLot] = await Promise.all([
    line.inventoryLotId
      ? tx.inventoryLot.findFirst({ where: { id: line.inventoryLotId, itemId: item.id } })
      : null,
    line.productionLotId
      ? tx.productionLot.findFirst({
          where: { id: line.productionLotId, finishedGoodId: item.id },
        })
      : null,
  ]);
  if (
    (line.inventoryLotId && !inventoryLot) ||
    (line.productionLotId && !productionLot) ||
    (!line.inventoryLotId && !line.productionLotId)
  )
    throw new WasteDispositionRepositoryError(
      "invalid-reference",
      "Disposition lot provenance does not match the selected item.",
    );
  const balance = await tx.inventoryMovement.aggregate({
    where: {
      itemId: item.id,
      warehouseId,
      canonicalUnitId: item.stockUnitId,
      status: line.sourceStatus,
      inventoryLotId: line.inventoryLotId ?? null,
      productionLotId: line.productionLotId ?? null,
    },
    _sum: { quantity: true },
  });
  const checked = validateWasteDispositionLine({
    itemType: item.itemType,
    sourceStatus: line.sourceStatus,
    action: line.action,
    reason: line.reason,
    notes: line.notes,
    quantity: line.quantity,
    eligibleQuantity: balance._sum.quantity?.toString() ?? "0",
    inventoryLotId: line.inventoryLotId ?? null,
    productionLotId: line.productionLotId ?? null,
    sourceExpiry: productionLot?.expiryDate ?? null,
    reprocessShelfLifeDays: item.finishedGoodProfile?.reprocessShelfLifeDays ?? null,
    today: dispositionDate,
  });
  return {
    position,
    itemId: item.id,
    warehouseId,
    inventoryLotId: line.inventoryLotId ?? null,
    productionLotId: line.productionLotId ?? null,
    sourceStatus: line.sourceStatus,
    enteredQuantity: checked.quantity,
    canonicalUnitId: item.stockUnitId,
    canonicalUnitDimension: item.stockUnit.dimension,
    action: line.action,
    reason: line.reason,
    notes: line.notes ?? null,
  };
}

async function requireInventoryAuthority(tx: Prisma.TransactionClient, actorUserId: string) {
  const actor = await tx.user.findFirst({
    where: {
      id: actorUserId,
      active: true,
      roles: {
        some: {
          role: { permissions: { some: { permission: { code: "inventory.manage" } } } },
        },
      },
    },
  });
  if (!actor)
    throw new WasteDispositionRepositoryError(
      "invalid-reference",
      "Inventory management permission is required.",
    );
}

async function nextDocumentNumber(tx: Prisma.TransactionClient, year: number) {
  const row = await tx.wasteDispositionSequence.upsert({
    where: { year },
    create: { year, nextValue: 2 },
    update: { nextValue: { increment: 1 } },
  });
  return `WD-${year}-${String(row.nextValue - 1).padStart(6, "0")}`;
}

function utcDate(value: string) {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()))
    throw new WasteDispositionRepositoryError("invalid-reference", "Disposition date is invalid.");
  return parsed;
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
      throw error;
    }
  throw new WasteDispositionRepositoryError("conflict", "Disposition posting conflict; retry.");
}
