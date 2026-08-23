"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import type { MasterActionState } from "@/components/master-data/action-state";
import {
  saveCategory,
  setCategoryActive,
} from "@/modules/master-data/application/manage-categories";
import { PrismaMasterDataRepository } from "@/server/master-data/prisma-master-data-repository";
import { requirePermission } from "@/server/auth/server-guards";

const repository = new PrismaMasterDataRepository();
const statusSchema = z.object({ id: z.string().min(1), active: z.enum(["true", "false"]) });

export async function saveCategoryAction(
  _state: MasterActionState,
  formData: FormData,
): Promise<MasterActionState> {
  const actor = await requirePermission("inventory.manage");
  const id = formData.get("id");
  const result = await saveCategory(
    actor,
    {
      id: typeof id === "string" && id ? id : undefined,
      code: formData.get("code"),
      name: formData.get("name"),
      itemType: formData.get("itemType"),
      description: formData.get("description"),
    },
    new PrismaMasterDataRepository(),
  );
  if (!result.ok) return { status: "error", message: result.message };
  revalidatePath("/inventory/categories");
  return { status: "success", message: "Category saved." };
}

export async function setCategoryStatusAction(
  _state: MasterActionState,
  formData: FormData,
): Promise<MasterActionState> {
  const actor = await requirePermission("inventory.manage");
  const parsed = statusSchema.safeParse({ id: formData.get("id"), active: formData.get("active") });
  if (!parsed.success) return { status: "error", message: "The status request is invalid." };
  const result = await setCategoryActive(
    actor,
    parsed.data.id,
    parsed.data.active === "true",
    repository,
  );
  if (!result.ok) return { status: "error", message: result.message };
  revalidatePath("/inventory/categories");
  return { status: "success", message: "Category status updated." };
}
