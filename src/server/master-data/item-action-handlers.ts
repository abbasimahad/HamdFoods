import "server-only";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import type { MasterActionState } from "@/components/master-data/action-state";
import { saveItem, setItemActive } from "@/modules/master-data/application/manage-items";
import type { ItemType } from "@/modules/master-data/domain/master-data";
import { requirePermission } from "@/server/auth/server-guards";

import { PrismaMasterDataRepository } from "./prisma-master-data-repository";

const statusSchema = z.object({ id: z.string().min(1), active: z.enum(["true", "false"]) });

export async function executeSaveItemAction(
  itemType: ItemType,
  route: string,
  formData: FormData,
): Promise<MasterActionState> {
  const actor = await requirePermission("inventory.manage");
  const id = optionalString(formData.get("id"));
  const common = {
    id,
    itemType,
    code: formData.get("code"),
    name: formData.get("name"),
    categoryId: formData.get("categoryId"),
    stockUnitId: formData.get("stockUnitId"),
    description: formData.get("description"),
  };
  const typeSpecific =
    itemType === "PACKAGING_MATERIAL"
      ? { packagingKind: formData.get("packagingKind") }
      : itemType === "FINISHED_GOOD"
        ? {
            netContentQuantity: formData.get("netContentQuantity"),
            netContentUnitId: formData.get("netContentUnitId"),
            piecesPerCarton: formData.get("piecesPerCarton"),
          }
        : {};
  const result = await saveItem(
    actor,
    { ...common, ...typeSpecific },
    new PrismaMasterDataRepository(),
  );
  if (!result.ok) return { status: "error", message: result.message };
  revalidatePath(route);
  return { status: "success", message: "Item saved." };
}

export async function executeSetItemStatusAction(
  itemType: ItemType,
  route: string,
  formData: FormData,
): Promise<MasterActionState> {
  const actor = await requirePermission("inventory.manage");
  const parsed = statusSchema.safeParse({ id: formData.get("id"), active: formData.get("active") });
  if (!parsed.success) return { status: "error", message: "The status request is invalid." };
  const result = await setItemActive(
    actor,
    parsed.data.id,
    itemType,
    parsed.data.active === "true",
    new PrismaMasterDataRepository(),
  );
  if (!result.ok) return { status: "error", message: result.message };
  revalidatePath(route);
  return { status: "success", message: "Item status updated." };
}

function optionalString(value: FormDataEntryValue | null) {
  return typeof value === "string" && value ? value : undefined;
}
