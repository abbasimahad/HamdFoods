"use server";

import { revalidatePath } from "next/cache";
import type { CostingActionState } from "@/components/costing/costing-action-state";
import {
  initializeValuationIssue,
  postLandedCost,
  postValuationAdjustment,
  rebuildValuation,
} from "@/modules/costing/application/manage-costing";
import { requirePermission } from "@/server/auth/server-guards";
import { PrismaInventoryValuationRepository } from "@/server/costing/prisma-inventory-valuation-repository";

const repository = new PrismaInventoryValuationRepository();
export async function rebuildValuationAction(
  previous: CostingActionState,
  formData: FormData,
): Promise<CostingActionState> {
  void previous;
  void formData;
  const actor = await requirePermission("inventory.manage");
  const result = await rebuildValuation(actor, repository);
  if (result.ok) refresh();
  return {
    ok: result.ok,
    message: result.ok ? (result.message ?? "Valuation rebuilt.") : result.message,
  };
}
export async function initializeValuationAction(
  _: CostingActionState,
  formData: FormData,
): Promise<CostingActionState> {
  const actor = await requirePermission("inventory.manage");
  const result = await initializeValuationIssue(actor, Object.fromEntries(formData), repository);
  if (result.ok) refresh();
  return {
    ok: result.ok,
    message: result.ok ? "Missing valuation basis initialized." : result.message,
  };
}
export async function postLandedCostAction(
  _: CostingActionState,
  formData: FormData,
): Promise<CostingActionState> {
  const actor = await requirePermission("inventory.manage");
  const result = await postLandedCost(actor, Object.fromEntries(formData), repository);
  if (result.ok) refresh();
  return {
    ok: result.ok,
    message: result.ok ? "Landed cost posted as a monetary true-up." : result.message,
  };
}
export async function postValuationAdjustmentAction(
  _: CostingActionState,
  formData: FormData,
): Promise<CostingActionState> {
  const actor = await requirePermission("inventory.manage");
  const result = await postValuationAdjustment(actor, Object.fromEntries(formData), repository);
  if (result.ok) refresh();
  return {
    ok: result.ok,
    message: result.ok ? "Monetary valuation adjustment posted." : result.message,
  };
}
function refresh() {
  revalidatePath("/inventory/valuation");
  revalidatePath("/production/batches");
  revalidatePath("/inventory/finished-goods");
}
