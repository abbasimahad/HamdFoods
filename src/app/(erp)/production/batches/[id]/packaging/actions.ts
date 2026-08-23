"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { ProductionActionState } from "@/components/production/action-state";
import {
  cancelPackagingTransaction,
  postPackagingTransaction,
  savePackagingTransaction,
} from "@/modules/production/application/manage-packaging-transactions";
import { requirePermission } from "@/server/auth/server-guards";
import { PrismaProductionPackagingRepository } from "@/server/production/prisma-production-packaging-repository";

const repository = new PrismaProductionPackagingRepository();

export async function savePackagingTransactionAction(
  _state: ProductionActionState,
  formData: FormData,
): Promise<ProductionActionState> {
  const actor = await requirePermission("production.manage");
  const result = await savePackagingTransaction(actor, Object.fromEntries(formData), repository);
  if (result.ok) {
    const batchId = String(formData.get("productionBatchId") ?? "");
    refresh(batchId);
    redirect(`/production/batches/${batchId}/packaging`);
  }
  return { ok: false, message: result.message };
}

export async function postPackagingTransactionAction(
  _state: ProductionActionState,
  formData: FormData,
): Promise<ProductionActionState> {
  const actor = await requirePermission("production.manage");
  const id = String(formData.get("transactionId") ?? "");
  const batchId = String(formData.get("productionBatchId") ?? "");
  const result = await postPackagingTransaction(actor, id, repository);
  if (result.ok) refresh(batchId);
  return {
    ok: result.ok,
    message: result.ok ? "Packaging transaction posted to the inventory ledger." : result.message,
  };
}

export async function cancelPackagingTransactionAction(
  _state: ProductionActionState,
  formData: FormData,
): Promise<ProductionActionState> {
  const actor = await requirePermission("production.manage");
  const id = String(formData.get("transactionId") ?? "");
  const batchId = String(formData.get("productionBatchId") ?? "");
  const result = await cancelPackagingTransaction(
    actor,
    id,
    String(formData.get("reason") ?? ""),
    repository,
  );
  if (result.ok) refresh(batchId);
  return {
    ok: result.ok,
    message: result.ok ? "Draft packaging transaction cancelled." : result.message,
  };
}

function refresh(batchId: string) {
  revalidatePath("/production/batches");
  revalidatePath(`/production/batches/${batchId}`);
  revalidatePath(`/production/batches/${batchId}/packaging`);
}
