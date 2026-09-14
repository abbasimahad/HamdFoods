"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import type { InventoryActionState } from "@/components/inventory/action-state";
import {
  cancelWasteDisposition,
  postWasteDisposition,
  reverseWasteDisposition,
  saveWasteDispositionDraft,
} from "@/modules/inventory/application/manage-waste-dispositions";
import { requirePermission } from "@/server/auth/server-guards";
import { PrismaWasteDispositionRepository } from "@/server/inventory/prisma-waste-disposition-repository";

const repository = new PrismaWasteDispositionRepository();

export async function saveWasteDispositionAction(
  _state: InventoryActionState,
  formData: FormData,
): Promise<InventoryActionState> {
  const actor = await requirePermission("inventory.manage");
  let lines: unknown = [];
  try {
    lines = JSON.parse(String(formData.get("lines") ?? "[]"));
  } catch {
    return { ok: false, message: "Disposition lines could not be read. Review and try again." };
  }
  const result = await saveWasteDispositionDraft(
    actor,
    { ...Object.fromEntries(formData), lines },
    repository,
  );
  if (result.ok) {
    revalidatePath("/production/waste-damage");
    redirect(`/production/waste-damage/${result.id}`);
  }
  return result;
}

export async function postWasteDispositionAction(_state: InventoryActionState, formData: FormData) {
  const actor = await requirePermission("inventory.manage");
  return lifecycle(await postWasteDisposition(actor, String(formData.get("id") ?? ""), repository));
}

export async function cancelWasteDispositionAction(
  _state: InventoryActionState,
  formData: FormData,
) {
  const actor = await requirePermission("inventory.manage");
  return lifecycle(
    await cancelWasteDisposition(
      actor,
      String(formData.get("id") ?? ""),
      String(formData.get("reason") ?? ""),
      repository,
    ),
  );
}

export async function reverseWasteDispositionAction(
  _state: InventoryActionState,
  formData: FormData,
) {
  const actor = await requirePermission("inventory.manage");
  return lifecycle(
    await reverseWasteDisposition(
      actor,
      String(formData.get("id") ?? ""),
      String(formData.get("reason") ?? ""),
      repository,
    ),
  );
}

function lifecycle(result: { ok: boolean; id?: string; message?: string }): InventoryActionState {
  if (result.ok) {
    revalidatePath("/production/waste-damage");
    if (result.id) revalidatePath(`/production/waste-damage/${result.id}`);
    revalidatePath("/inventory/stock-overview");
    revalidatePath("/inventory/stock-movements");
  }
  return {
    ok: result.ok,
    message: result.ok ? "Disposition status updated." : (result.message ?? "Action failed."),
  };
}
