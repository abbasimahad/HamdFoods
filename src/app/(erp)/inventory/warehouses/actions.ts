"use server";

import { revalidatePath } from "next/cache";

import type { InventoryActionState } from "@/components/inventory/action-state";
import {
  saveWarehouse,
  setWarehouseActive,
} from "@/modules/inventory/application/manage-warehouses";
import { requirePermission } from "@/server/auth/server-guards";
import { PrismaInventoryRepository } from "@/server/inventory/prisma-inventory-repository";

const repository = new PrismaInventoryRepository();

export async function saveWarehouseAction(
  _state: InventoryActionState,
  formData: FormData,
): Promise<InventoryActionState> {
  const actor = await requirePermission("inventory.manage");
  const result = await saveWarehouse(actor, Object.fromEntries(formData), repository);
  if (result.ok) revalidatePath("/inventory/warehouses");
  return { ok: result.ok, message: result.ok ? "Warehouse saved." : result.message };
}

export async function setWarehouseStatusAction(
  _state: InventoryActionState,
  formData: FormData,
): Promise<InventoryActionState> {
  const actor = await requirePermission("inventory.manage");
  const result = await setWarehouseActive(
    actor,
    String(formData.get("id") ?? ""),
    formData.get("active") === "true",
    repository,
  );
  if (result.ok) revalidatePath("/inventory/warehouses");
  return { ok: result.ok, message: result.ok ? "Warehouse status updated." : result.message };
}
