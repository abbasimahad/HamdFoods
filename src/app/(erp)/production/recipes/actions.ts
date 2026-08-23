"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { ProductionActionState } from "@/components/production/action-state";
import type { PackagingState, ScaleState } from "@/components/production/recipe-calculators";
import {
  approveRecipe,
  createNewRecipeVersion,
  inactivateRecipe,
  saveRecipe,
} from "@/modules/production/application/manage-recipes";
import { requirePermission } from "@/server/auth/server-guards";
import { PrismaRecipeRepository } from "@/server/production/prisma-recipe-repository";

const repository = new PrismaRecipeRepository();
export async function saveRecipeAction(
  _state: ProductionActionState,
  formData: FormData,
): Promise<ProductionActionState> {
  const actor = await requirePermission("production.manage");
  const result = await saveRecipe(actor, Object.fromEntries(formData), repository);
  if (result.ok && result.id) {
    refresh(result.id);
    redirect(`/production/recipes/${result.id}`);
  }
  return { ok: false, message: result.ok ? "Recipe saved." : result.message };
}
export async function approveRecipeAction(
  _state: ProductionActionState,
  formData: FormData,
): Promise<ProductionActionState> {
  const actor = await requirePermission("production.manage");
  const id = String(formData.get("id") ?? "");
  const result = await approveRecipe(actor, id, repository);
  if (result.ok) refresh(id);
  return {
    ok: result.ok,
    message: result.ok ? "Recipe approved as the current version." : result.message,
  };
}
export async function inactivateRecipeAction(
  _state: ProductionActionState,
  formData: FormData,
): Promise<ProductionActionState> {
  const actor = await requirePermission("production.manage");
  const id = String(formData.get("id") ?? "");
  const result = await inactivateRecipe(actor, id, repository);
  if (result.ok) refresh(id);
  return { ok: result.ok, message: result.ok ? "Recipe made inactive." : result.message };
}
export async function createNewRecipeVersionAction(
  _state: ProductionActionState,
  formData: FormData,
): Promise<ProductionActionState> {
  const actor = await requirePermission("production.manage");
  const result = await createNewRecipeVersion(actor, String(formData.get("id") ?? ""), repository);
  if (result.ok && result.id) {
    refresh(result.id);
    redirect(`/production/recipes/${result.id}/edit`);
  }
  return { ok: false, message: result.ok ? "New version created." : result.message };
}
export async function scaleRecipeAction(
  _state: ScaleState,
  formData: FormData,
): Promise<ScaleState> {
  await requirePermission("production.view");
  try {
    return {
      message: "Scaling calculated; no inventory was changed.",
      result: await repository.scaleRecipe(
        String(formData.get("id") ?? ""),
        String(formData.get("targetQuantity") ?? ""),
        String(formData.get("targetUnitId") ?? ""),
      ),
    };
  } catch (error) {
    return { message: error instanceof Error ? error.message : "Recipe could not be scaled." };
  }
}
export async function calculatePackagingAction(
  _state: PackagingState,
  formData: FormData,
): Promise<PackagingState> {
  await requirePermission("production.view");
  try {
    return {
      message: "Packaging requirement calculated; no inventory was changed.",
      result: await repository.calculatePackaging(
        String(formData.get("id") ?? ""),
        String(formData.get("cartons") ?? "0"),
        String(formData.get("loosePieces") ?? "0"),
      ),
    };
  } catch (error) {
    return {
      message: error instanceof Error ? error.message : "Packaging could not be calculated.",
    };
  }
}
function refresh(id: string) {
  revalidatePath("/production");
  revalidatePath("/production/recipes");
  revalidatePath(`/production/recipes/${id}`);
  revalidatePath("/inventory/finished-goods");
}
