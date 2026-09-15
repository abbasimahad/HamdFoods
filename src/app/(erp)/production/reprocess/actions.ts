"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import type { ProductionActionState } from "@/components/production/action-state";
import {
  cancelReprocess,
  decideReprocessQuality,
  reserveReprocess,
  saveReprocessDraft,
  startReprocess,
  updateReprocessDraft,
} from "@/modules/production/application/manage-reprocess";
import { requirePermission } from "@/server/auth/licensed-guards";
import { PrismaReprocessRepository } from "@/server/production/prisma-reprocess-repository";

const repository = new PrismaReprocessRepository();

export async function saveReprocessDraftAction(
  _state: ProductionActionState,
  formData: FormData,
): Promise<ProductionActionState> {
  const actor = await requirePermission("production.manage");
  const result = await saveReprocessDraft(actor, Object.fromEntries(formData), repository);
  if (result.ok) {
    revalidatePath("/production/reprocess");
    redirect(`/production/reprocess/${result.id}`);
  }
  return { ok: false, message: result.message };
}

export async function updateReprocessDraftAction(
  _state: ProductionActionState,
  formData: FormData,
): Promise<ProductionActionState> {
  const actor = await requirePermission("production.manage");
  const result = await updateReprocessDraft(actor, Object.fromEntries(formData), repository);
  if (result.ok) {
    revalidatePath("/production/reprocess");
    revalidatePath(`/production/reprocess/${result.id}`);
    redirect(`/production/reprocess/${result.id}`);
  }
  return { ok: false, message: result.message };
}

export async function reserveReprocessAction(
  _state: ProductionActionState,
  formData: FormData,
): Promise<ProductionActionState> {
  const actor = await requirePermission("production.manage");
  return lifecycle(await reserveReprocess(actor, String(formData.get("id") ?? ""), repository));
}

export async function startReprocessAction(
  _state: ProductionActionState,
  formData: FormData,
): Promise<ProductionActionState> {
  const actor = await requirePermission("production.manage");
  return lifecycle(await startReprocess(actor, String(formData.get("id") ?? ""), repository));
}

export async function cancelReprocessAction(
  _state: ProductionActionState,
  formData: FormData,
): Promise<ProductionActionState> {
  const actor = await requirePermission("production.manage");
  return lifecycle(
    await cancelReprocess(
      actor,
      String(formData.get("id") ?? ""),
      String(formData.get("reason") ?? ""),
      repository,
    ),
  );
}

export async function decideReprocessQualityAction(
  _state: ProductionActionState,
  formData: FormData,
): Promise<ProductionActionState> {
  const actor = await requirePermission("quality.manage");
  const result = await decideReprocessQuality(actor, Object.fromEntries(formData), repository);
  if (result.ok) {
    revalidatePath("/production/reprocess");
    revalidatePath(`/production/reprocess/${result.id}`);
    revalidatePath("/inventory/stock-overview");
    revalidatePath("/inventory/stock-movements");
    redirect(`/production/reprocess/${result.id}`);
  }
  return {
    ok: result.ok,
    message: result.ok ? "Reprocess quality decision posted." : result.message,
  };
}

function lifecycle(result: Awaited<ReturnType<typeof reserveReprocess>>): ProductionActionState {
  if (result.ok) {
    revalidatePath("/production/reprocess");
    revalidatePath(`/production/reprocess/${result.id}`);
  }
  return { ok: result.ok, message: result.ok ? "Reprocess status updated." : result.message };
}
