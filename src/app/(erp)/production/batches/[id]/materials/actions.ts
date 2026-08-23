"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { ProductionActionState } from "@/components/production/action-state";
import {
  cancelMaterialTransaction,
  postMaterialTransaction,
  saveMaterialTransaction,
} from "@/modules/production/application/manage-material-transactions";
import { requirePermission } from "@/server/auth/server-guards";
import { PrismaProductionMaterialRepository } from "@/server/production/prisma-production-material-repository";

const repository = new PrismaProductionMaterialRepository();

export async function saveMaterialTransactionAction(
  _state: ProductionActionState,
  formData: FormData,
): Promise<ProductionActionState> {
  const actor = await requirePermission("production.manage");
  const result = await saveMaterialTransaction(actor, Object.fromEntries(formData), repository);
  if (result.ok) {
    const batchId = String(formData.get("productionBatchId") ?? "");
    refresh(batchId);
    redirect(`/production/batches/${batchId}/materials`);
  }
  return { ok: false, message: result.message };
}

export async function postMaterialTransactionAction(
  _state: ProductionActionState,
  formData: FormData,
): Promise<ProductionActionState> {
  const actor = await requirePermission("production.manage");
  const id = String(formData.get("transactionId") ?? "");
  const batchId = String(formData.get("productionBatchId") ?? "");
  const result = await postMaterialTransaction(actor, id, repository);
  if (result.ok) refresh(batchId);
  return {
    ok: result.ok,
    message: result.ok ? "Material transaction posted to the inventory ledger." : result.message,
  };
}

export async function cancelMaterialTransactionAction(
  _state: ProductionActionState,
  formData: FormData,
): Promise<ProductionActionState> {
  const actor = await requirePermission("production.manage");
  const id = String(formData.get("transactionId") ?? "");
  const batchId = String(formData.get("productionBatchId") ?? "");
  const result = await cancelMaterialTransaction(
    actor,
    id,
    String(formData.get("reason") ?? ""),
    repository,
  );
  if (result.ok) refresh(batchId);
  return { ok: result.ok, message: result.ok ? "Draft transaction cancelled." : result.message };
}

function refresh(batchId: string) {
  revalidatePath("/production/batches");
  revalidatePath(`/production/batches/${batchId}`);
  revalidatePath(`/production/batches/${batchId}/materials`);
}
