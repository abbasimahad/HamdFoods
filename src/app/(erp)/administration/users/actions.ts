"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import {
  createManagedUser,
  replaceUserRoles,
  setUserActive,
} from "@/modules/access/application/manage-users";
import { PrismaAccessRepository } from "@/server/access/prisma-access-repository";
import { requirePermission } from "@/server/auth/server-guards";

export type UserActionState = { status: "idle" | "success" | "error"; message: string };
export const initialUserActionState: UserActionState = { status: "idle", message: "" };
const repository = new PrismaAccessRepository();

const createSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.email().transform((value) => value.trim().toLowerCase()),
  password: z.string().min(8).max(128),
  roleCodes: z.array(z.string().min(1)).min(1),
  active: z.boolean(),
});
const rolesSchema = z.object({
  userId: z.string().min(1),
  roleCodes: z.array(z.string().min(1)).min(1),
});
const statusSchema = z.object({
  userId: z.string().min(1),
  active: z.enum(["true", "false"]).transform((value) => value === "true"),
});

export async function createUserAction(
  _state: UserActionState,
  formData: FormData,
): Promise<UserActionState> {
  const actor = await requirePermission("users.manage");
  const parsed = createSchema.safeParse({
    name: formData.get("name"),
    email: formData.get("email"),
    password: formData.get("password"),
    roleCodes: formData.getAll("roleCodes"),
    active: formData.get("active") === "on",
  });
  if (!parsed.success) return { status: "error", message: "Check the required user details." };
  try {
    const result = await createManagedUser(actor, parsed.data, repository);
    if (!result.ok) return { status: "error", message: mutationMessage(result.reason) };
    revalidatePath("/administration/users");
    return { status: "success", message: "User created." };
  } catch {
    return {
      status: "error",
      message: "The user could not be created. The email may already be in use.",
    };
  }
}

export async function replaceUserRolesAction(
  _state: UserActionState,
  formData: FormData,
): Promise<UserActionState> {
  const actor = await requirePermission("users.manage");
  const parsed = rolesSchema.safeParse({
    userId: formData.get("userId"),
    roleCodes: formData.getAll("roleCodes"),
  });
  if (!parsed.success) return { status: "error", message: "Select at least one valid role." };
  try {
    const result = await replaceUserRoles(
      actor,
      parsed.data.userId,
      parsed.data.roleCodes,
      repository,
    );
    if (!result.ok) return { status: "error", message: mutationMessage(result.reason) };
    revalidatePath("/administration/users");
    return { status: "success", message: "Roles updated." };
  } catch {
    return { status: "error", message: "The roles could not be updated. Try again." };
  }
}

export async function setUserStatusAction(
  _state: UserActionState,
  formData: FormData,
): Promise<UserActionState> {
  const actor = await requirePermission("users.manage");
  const parsed = statusSchema.safeParse({
    userId: formData.get("userId"),
    active: formData.get("active"),
  });
  if (!parsed.success) return { status: "error", message: "The status request is invalid." };
  try {
    const result = await setUserActive(actor, parsed.data.userId, parsed.data.active, repository);
    if (!result.ok) return { status: "error", message: mutationMessage(result.reason) };
    revalidatePath("/administration/users");
    return { status: "success", message: "User status updated." };
  } catch {
    return { status: "error", message: "The user status could not be updated. Try again." };
  }
}

function mutationMessage(reason: string) {
  const messages: Record<string, string> = {
    forbidden: "You are not allowed to perform this action.",
    "invalid-roles": "Select at least one valid role.",
    "protected-role": "Only a SUPER_ADMIN can manage SUPER_ADMIN access.",
    "self-change": "You cannot remove access from your current account.",
    "last-super-admin": "The last active SUPER_ADMIN must be preserved.",
    "not-found": "The selected user no longer exists.",
  };
  return messages[reason] ?? "The change could not be completed.";
}
