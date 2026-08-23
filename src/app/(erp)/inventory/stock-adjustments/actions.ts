"use server";

import { revalidatePath } from "next/cache";

import type { InventoryActionState } from "@/components/inventory/action-state";
import {
  postSingleInventory,
  transferInventoryWarehouse,
} from "@/modules/inventory/application/posting";
import { requirePermission } from "@/server/auth/server-guards";
import { PrismaInventoryRepository } from "@/server/inventory/prisma-inventory-repository";

const repository = new PrismaInventoryRepository();

export async function postSingleInventoryAction(
  _state: InventoryActionState,
  formData: FormData,
): Promise<InventoryActionState> {
  const actor = await requirePermission("inventory.manage");
  const result = await postSingleInventory(actor, Object.fromEntries(formData), repository);
  if (result.ok) refresh();
  return { ok: result.ok, message: result.ok ? "Inventory movement posted." : result.message };
}

export async function transferInventoryAction(
  _state: InventoryActionState,
  formData: FormData,
): Promise<InventoryActionState> {
  const actor = await requirePermission("inventory.manage");
  const result = await transferInventoryWarehouse(actor, Object.fromEntries(formData), repository);
  if (result.ok) refresh();
  return {
    ok: result.ok,
    message: result.ok ? "Warehouse transfer posted atomically." : result.message,
  };
}

function refresh() {
  revalidatePath("/inventory/stock-adjustments");
  revalidatePath("/inventory/stock-overview");
  revalidatePath("/inventory/stock-movements");
}
