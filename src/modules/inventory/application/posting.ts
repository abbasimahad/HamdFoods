import { z } from "zod";

import type { ApplicationPrincipal } from "@/modules/access/domain/principal";

import { INVENTORY_STATUSES } from "../domain/inventory";
import {
  inventoryManageForbidden,
  InventoryRepositoryError,
  type InventoryMutationResult,
  type InventoryRepository,
  type SinglePostingCommand,
  type StatusTransferCommand,
  type WarehouseTransferCommand,
} from "./contracts";

const quantityFields = {
  quantity: z.string().trim().max(61).optional(),
  unitId: z.string().trim().optional(),
  cartons: z.string().trim().max(30).optional(),
  loosePieces: z.string().trim().max(30).optional(),
};
const common = {
  itemId: z.string().min(1),
  status: z.enum(INVENTORY_STATUSES),
  reason: z.string().trim().min(3).max(1000),
  referenceId: z.string().trim().max(120).optional().transform(emptyToUndefined),
  sourceKey: z.string().trim().max(160).optional().transform(emptyToUndefined),
};
export const singlePostingSchema = z.object({
  ...common,
  ...quantityFields,
  warehouseId: z.string().min(1),
  movementType: z.enum(["OPENING_BALANCE", "ADJUSTMENT_IN", "ADJUSTMENT_OUT"]),
});
export const warehouseTransferSchema = z.object({
  ...common,
  ...quantityFields,
  sourceWarehouseId: z.string().min(1),
  destinationWarehouseId: z.string().min(1),
  referenceId: z.string().trim().min(1).max(120),
});
export const statusTransferSchema = z.object({
  ...quantityFields,
  itemId: z.string().min(1),
  warehouseId: z.string().min(1),
  sourceStatus: z.enum(INVENTORY_STATUSES),
  destinationStatus: z.enum(INVENTORY_STATUSES),
  referenceId: z.string().trim().min(1).max(120),
  sourceKey: z.string().trim().max(160).optional().transform(emptyToUndefined),
  reason: z.string().trim().min(3).max(1000),
});

export async function postSingleInventory(
  actor: ApplicationPrincipal,
  input: unknown,
  repository: InventoryRepository,
): Promise<InventoryMutationResult> {
  const forbidden = inventoryManageForbidden(actor);
  if (forbidden) return forbidden;
  const parsed = singlePostingSchema.safeParse(input);
  if (!parsed.success) return invalid();
  return execute(() =>
    repository.postSingle({
      ...parsed.data,
      referenceType:
        parsed.data.movementType === "OPENING_BALANCE" ? "OPENING_STOCK" : "MANUAL_ADJUSTMENT",
      actorUserId: actor.id,
    } as SinglePostingCommand),
  );
}

export async function transferInventoryWarehouse(
  actor: ApplicationPrincipal,
  input: unknown,
  repository: InventoryRepository,
): Promise<InventoryMutationResult> {
  const forbidden = inventoryManageForbidden(actor);
  if (forbidden) return forbidden;
  const parsed = warehouseTransferSchema.safeParse(input);
  if (!parsed.success || parsed.data.sourceWarehouseId === parsed.data.destinationWarehouseId) {
    return invalid("Source and destination warehouses must be different.");
  }
  return execute(() =>
    repository.transferWarehouse({
      ...parsed.data,
      actorUserId: actor.id,
    } as WarehouseTransferCommand),
  );
}

export async function moveInventoryStatus(
  actor: ApplicationPrincipal,
  input: unknown,
  repository: InventoryRepository,
): Promise<InventoryMutationResult> {
  const forbidden = inventoryManageForbidden(actor);
  if (forbidden) return forbidden;
  const parsed = statusTransferSchema.safeParse(input);
  if (!parsed.success || parsed.data.sourceStatus === parsed.data.destinationStatus) {
    return invalid("Source and destination statuses must be different.");
  }
  return execute(() =>
    repository.moveStatus({ ...parsed.data, actorUserId: actor.id } as StatusTransferCommand),
  );
}

async function execute(operation: () => Promise<string>): Promise<InventoryMutationResult> {
  try {
    return { ok: true, id: await operation() };
  } catch (error) {
    if (error instanceof InventoryRepositoryError) {
      return { ok: false, reason: error.reason, message: error.message };
    }
    return { ok: false, reason: "conflict", message: "Inventory could not be posted." };
  }
}

function invalid(message = "Check the inventory posting details."): InventoryMutationResult {
  return { ok: false, reason: "validation", message };
}
function emptyToUndefined(value?: string) {
  return value || undefined;
}
