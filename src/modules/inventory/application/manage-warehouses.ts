import { z } from "zod";

import type { ApplicationPrincipal } from "@/modules/access/domain/principal";
import { isValidMasterCode, normalizeMasterCode } from "@/modules/master-data/domain/master-data";

import {
  inventoryManageForbidden,
  InventoryRepositoryError,
  type InventoryMutationResult,
  type InventoryRepository,
} from "./contracts";

export const warehouseInputSchema = z.object({
  id: z.string().min(1).optional(),
  code: z.string().transform(normalizeMasterCode).refine(isValidMasterCode),
  name: z.string().trim().min(1).max(160),
  description: z
    .string()
    .trim()
    .max(2000)
    .optional()
    .transform((value) => value || undefined),
});

export async function saveWarehouse(
  actor: ApplicationPrincipal,
  input: unknown,
  repository: InventoryRepository,
): Promise<InventoryMutationResult> {
  const forbidden = inventoryManageForbidden(actor);
  if (forbidden) return forbidden;
  const parsed = warehouseInputSchema.safeParse(input);
  if (!parsed.success)
    return { ok: false, reason: "validation", message: "Check warehouse details." };
  try {
    return { ok: true, id: await repository.saveWarehouse(parsed.data) };
  } catch (error) {
    return failure(error);
  }
}

export async function setWarehouseActive(
  actor: ApplicationPrincipal,
  id: string,
  active: boolean,
  repository: InventoryRepository,
): Promise<InventoryMutationResult> {
  const forbidden = inventoryManageForbidden(actor);
  if (forbidden) return forbidden;
  try {
    return (await repository.setWarehouseActive(id, active))
      ? { ok: true, id }
      : { ok: false, reason: "reference", message: "Warehouse not found." };
  } catch (error) {
    return failure(error);
  }
}

function failure(error: unknown): InventoryMutationResult {
  return error instanceof InventoryRepositoryError
    ? { ok: false, reason: error.reason, message: error.message }
    : { ok: false, reason: "conflict", message: "Warehouse could not be saved." };
}
