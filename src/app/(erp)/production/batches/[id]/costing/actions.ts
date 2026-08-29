"use server";

import { revalidatePath } from "next/cache";
import type { CostingActionState } from "@/components/costing/costing-action-state";
import {
  addProductionCost,
  finalizeProductionCost,
} from "@/modules/costing/application/manage-costing";
import { requirePermission } from "@/server/auth/server-guards";
import { PrismaInventoryValuationRepository } from "@/server/costing/prisma-inventory-valuation-repository";

const repository = new PrismaInventoryValuationRepository();
export async function addProductionCostAction(
  _: CostingActionState,
  formData: FormData,
): Promise<CostingActionState> {
  const actor = await requirePermission("production.manage");
  const result = await addProductionCost(actor, Object.fromEntries(formData), repository);
  const id = String(formData.get("productionBatchId") ?? "");
  if (result.ok) refresh(id);
  return { ok: result.ok, message: result.ok ? "Production cost entry added." : result.message };
}
export async function finalizeProductionCostAction(
  _: CostingActionState,
  formData: FormData,
): Promise<CostingActionState> {
  const actor = await requirePermission("production.manage");
  const id = String(formData.get("batchId") ?? "");
  const result = await finalizeProductionCost(actor, id, repository);
  if (result.ok) refresh(id);
  return {
    ok: result.ok,
    message: result.ok ? "Batch cost finalized and finished output valued." : result.message,
  };
}
function refresh(id: string) {
  revalidatePath(`/production/batches/${id}/costing`);
  revalidatePath(`/production/batches/${id}`);
  revalidatePath("/inventory/valuation");
}
