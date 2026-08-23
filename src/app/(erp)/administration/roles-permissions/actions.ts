"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { replaceRolePermissions } from "@/modules/access/application/manage-role-permissions";
import { PrismaAccessRepository } from "@/server/access/prisma-access-repository";
import { requirePermission } from "@/server/auth/server-guards";

export type RoleActionState = { status: "idle" | "success" | "error"; message: string };
export const initialRoleActionState: RoleActionState = { status: "idle", message: "" };
const rolePermissionsSchema = z.object({
  roleCode: z.string().min(1),
  permissionCodes: z.array(z.string()).max(64),
});

export async function replaceRolePermissionsAction(
  _state: RoleActionState,
  formData: FormData,
): Promise<RoleActionState> {
  const actor = await requirePermission("roles.manage");
  const parsed = rolePermissionsSchema.safeParse({
    roleCode: formData.get("roleCode"),
    permissionCodes: formData.getAll("permissionCodes"),
  });
  if (!parsed.success) return { status: "error", message: "The submitted mapping is invalid." };
  try {
    const result = await replaceRolePermissions(
      actor,
      parsed.data.roleCode,
      parsed.data.permissionCodes,
      new PrismaAccessRepository(),
    );
    if (!result.ok) {
      const messages: Record<string, string> = {
        forbidden: "You are not allowed to change role permissions.",
        "invalid-permission": "The submitted permission list is invalid.",
        "protected-role": "SUPER_ADMIN permissions are immutable.",
        "not-found": "The selected role no longer exists.",
      };
      return { status: "error", message: messages[result.reason] ?? "The change failed." };
    }
    revalidatePath("/administration/roles-permissions");
    return { status: "success", message: "Permissions updated." };
  } catch {
    return { status: "error", message: "Permissions could not be updated. Try again." };
  }
}
