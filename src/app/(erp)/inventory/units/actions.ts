"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import type { MasterActionState } from "@/components/master-data/action-state";
import { saveUnit, setUnitActive } from "@/modules/master-data/application/manage-units";
import { PrismaMasterDataRepository } from "@/server/master-data/prisma-master-data-repository";
import { requirePermission } from "@/server/auth/server-guards";

const repository = new PrismaMasterDataRepository();
const statusSchema = z.object({ id: z.string().min(1), active: z.enum(["true", "false"]) });

export async function saveUnitAction(
  _state: MasterActionState,
  formData: FormData,
): Promise<MasterActionState> {
  const actor = await requirePermission("inventory.manage");
  const result = await saveUnit(
    actor,
    {
      id: optionalString(formData.get("id")),
      code: formData.get("code"),
      name: formData.get("name"),
      symbol: formData.get("symbol"),
      dimension: formData.get("dimension"),
    },
    repository,
  );
  if (!result.ok) return { status: "error", message: result.message };
  revalidatePath("/inventory/units");
  return { status: "success", message: "Unit saved." };
}

export async function setUnitStatusAction(
  _state: MasterActionState,
  formData: FormData,
): Promise<MasterActionState> {
  const actor = await requirePermission("inventory.manage");
  const parsed = statusSchema.safeParse({ id: formData.get("id"), active: formData.get("active") });
  if (!parsed.success) return { status: "error", message: "The status request is invalid." };
  const result = await setUnitActive(
    actor,
    parsed.data.id,
    parsed.data.active === "true",
    repository,
  );
  if (!result.ok) return { status: "error", message: result.message };
  revalidatePath("/inventory/units");
  return { status: "success", message: "Unit status updated." };
}

function optionalString(value: FormDataEntryValue | null) {
  return typeof value === "string" && value ? value : undefined;
}
