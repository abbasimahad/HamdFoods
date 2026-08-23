"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { ProductionActionState } from "@/components/production/action-state";
import {
  cancelOutputTransaction,
  completeProductionBatch,
  postOutputTransaction,
  saveOutputTransaction,
} from "@/modules/production/application/manage-output-transactions";
import { requirePermission } from "@/server/auth/server-guards";
import { PrismaProductionOutputRepository } from "@/server/production/prisma-production-output-repository";

const repository = new PrismaProductionOutputRepository();
export async function saveOutputTransactionAction(
  _state: ProductionActionState,
  formData: FormData,
): Promise<ProductionActionState> {
  const actor = await requirePermission("production.manage");
  const result = await saveOutputTransaction(actor, Object.fromEntries(formData), repository);
  if (result.ok) {
    const batchId = String(formData.get("productionBatchId") ?? "");
    refresh(batchId);
    redirect(`/production/batches/${batchId}/output`);
  }
  return { ok: false, message: result.message };
}
export async function postOutputTransactionAction(
  _state: ProductionActionState,
  formData: FormData,
): Promise<ProductionActionState> {
  const actor = await requirePermission("production.manage");
  const batchId = String(formData.get("batchId") ?? "");
  const result = await postOutputTransaction(
    actor,
    String(formData.get("transactionId") ?? ""),
    repository,
  );
  if (result.ok) refresh(batchId);
  return { ok: result.ok, message: result.ok ? "Production output posted." : result.message };
}
export async function cancelOutputTransactionAction(
  _state: ProductionActionState,
  formData: FormData,
): Promise<ProductionActionState> {
  const actor = await requirePermission("production.manage");
  const batchId = String(formData.get("batchId") ?? "");
  const result = await cancelOutputTransaction(
    actor,
    String(formData.get("transactionId") ?? ""),
    String(formData.get("reason") ?? ""),
    repository,
  );
  if (result.ok) refresh(batchId);
  return { ok: result.ok, message: result.ok ? "Output draft cancelled." : result.message };
}
export async function completeBatchAction(
  _state: ProductionActionState,
  formData: FormData,
): Promise<ProductionActionState> {
  const actor = await requirePermission("production.manage");
  const batchId = String(formData.get("batchId") ?? "");
  const result = await completeProductionBatch(
    actor,
    batchId,
    String(formData.get("explanation") ?? ""),
    repository,
  );
  if (result.ok) refresh(batchId);
  return { ok: result.ok, message: result.ok ? "Production batch completed." : result.message };
}
function refresh(batchId: string) {
  revalidatePath("/production/batches");
  revalidatePath(`/production/batches/${batchId}`);
  revalidatePath(`/production/batches/${batchId}/output`);
  revalidatePath("/inventory/stock-overview");
  revalidatePath("/inventory/stock-movements");
}
