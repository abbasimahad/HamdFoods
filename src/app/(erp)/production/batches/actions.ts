"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { ProductionActionState } from "@/components/production/action-state";
import {
  cancelProductionBatch,
  planProductionBatch,
  releaseProductionBatch,
  saveProductionBatch,
} from "@/modules/production/application/manage-batches";
import { requirePermission } from "@/server/auth/server-guards";
import { PrismaProductionBatchRepository } from "@/server/production/prisma-production-batch-repository";

const repository = new PrismaProductionBatchRepository();

export async function saveProductionBatchAction(
  _state: ProductionActionState,
  formData: FormData,
): Promise<ProductionActionState> {
  const actor = await requirePermission("production.manage");
  const result = await saveProductionBatch(actor, Object.fromEntries(formData), repository);
  if (result.ok) {
    refresh(result.id);
    redirect(`/production/batches/${result.id}`);
  }
  return { ok: false, message: result.message };
}

export async function planProductionBatchAction(
  _state: ProductionActionState,
  formData: FormData,
): Promise<ProductionActionState> {
  const actor = await requirePermission("production.manage");
  const result = await planProductionBatch(actor, String(formData.get("id") ?? ""), repository);
  if (result.ok) refresh(result.id);
  return {
    ok: result.ok,
    message: result.ok ? "Batch planned. Requirement snapshots are now frozen." : result.message,
  };
}

export async function releaseProductionBatchAction(
  _state: ProductionActionState,
  formData: FormData,
): Promise<ProductionActionState> {
  const actor = await requirePermission("production.manage");
  const result = await releaseProductionBatch(
    actor,
    String(formData.get("id") ?? ""),
    formData.get("acknowledgeShortage") === "on",
    repository,
  );
  if (result.ok) refresh(result.id);
  return {
    ok: result.ok,
    message: result.ok
      ? result.hasShortage
        ? "Batch released with acknowledged stock shortages. Inventory was not changed."
        : "Batch released. Inventory was not changed."
      : result.message,
  };
}

export async function cancelProductionBatchAction(
  _state: ProductionActionState,
  formData: FormData,
): Promise<ProductionActionState> {
  const actor = await requirePermission("production.manage");
  const result = await cancelProductionBatch(
    actor,
    String(formData.get("id") ?? ""),
    String(formData.get("reason") ?? ""),
    repository,
  );
  if (result.ok) refresh(result.id);
  return {
    ok: result.ok,
    message: result.ok ? "Batch cancelled without stock effect." : result.message,
  };
}

function refresh(id: string) {
  revalidatePath("/production");
  revalidatePath("/production/batches");
  revalidatePath(`/production/batches/${id}`);
}
