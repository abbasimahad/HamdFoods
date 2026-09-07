"use server";

import { z } from "zod";

import {
  changeOwnLoginEmail,
  changeOwnPassword,
  updateOwnDisplayName,
} from "@/modules/access/application/manage-account-security";
import { PrismaAccountSecurityRepository } from "@/server/access/prisma-account-security-repository";
import { requireUser } from "@/server/auth/server-guards";
import { serverEnv } from "@/server/server-env";

export type AccountSecurityActionState = {
  status: "idle" | "success" | "error";
  message: string;
  signedOut?: boolean;
};
export const initialAccountSecurityState: AccountSecurityActionState = {
  status: "idle",
  message: "",
};

const repository = new PrismaAccountSecurityRepository();
const displayNameSchema = z.string().trim().min(1).max(120);
const emailSchema = z.object({
  newEmail: z.email().transform((value) => value.trim().toLowerCase()),
  currentPassword: z.string().min(1).max(128),
});
const passwordSchema = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: z.string().min(8).max(128),
  confirmPassword: z.string().min(8).max(128),
});

export async function updateDisplayNameAction(
  _state: AccountSecurityActionState,
  formData: FormData,
): Promise<AccountSecurityActionState> {
  const actor = await requireUser();
  if (serverEnv.AUTH_BYPASS_ENABLED) return bypassMessage();
  const parsed = displayNameSchema.safeParse(formData.get("displayName"));
  if (!parsed.success) return error("Enter a display name between 1 and 120 characters.");
  try {
    const result = await updateOwnDisplayName(actor, parsed.data, repository);
    return result.ok ? success("Display name updated.") : error("The display name is invalid.");
  } catch {
    return error("The display name could not be updated. Try again.");
  }
}

export async function changeLoginEmailAction(
  _state: AccountSecurityActionState,
  formData: FormData,
): Promise<AccountSecurityActionState> {
  const actor = await requireUser();
  if (serverEnv.AUTH_BYPASS_ENABLED) return bypassMessage();
  const parsed = emailSchema.safeParse({
    newEmail: formData.get("newEmail"),
    currentPassword: formData.get("currentPassword"),
  });
  if (!parsed.success) return error("Enter a valid email and your current password.");
  try {
    const result = await changeOwnLoginEmail(
      actor,
      parsed.data.newEmail,
      parsed.data.currentPassword,
      repository,
    );
    if (!result.ok) return error(accountError(result.reason));
    return { status: "success", message: "Login email changed. Sign in again.", signedOut: true };
  } catch {
    return error("The login email could not be changed. It may already be in use.");
  }
}

export async function changePasswordAction(
  _state: AccountSecurityActionState,
  formData: FormData,
): Promise<AccountSecurityActionState> {
  const actor = await requireUser();
  if (serverEnv.AUTH_BYPASS_ENABLED) return bypassMessage();
  const parsed = passwordSchema.safeParse({
    currentPassword: formData.get("currentPassword"),
    newPassword: formData.get("newPassword"),
    confirmPassword: formData.get("confirmPassword"),
  });
  if (!parsed.success) return error("Use a password between 8 and 128 characters.");
  try {
    const result = await changeOwnPassword(
      actor,
      parsed.data.currentPassword,
      parsed.data.newPassword,
      parsed.data.confirmPassword,
      repository,
    );
    if (!result.ok) return error(accountError(result.reason));
    return { status: "success", message: "Password changed. Sign in again.", signedOut: true };
  } catch {
    return error("The password could not be changed. Try again.");
  }
}

function accountError(reason: string) {
  const messages: Record<string, string> = {
    "invalid-current-password": "The current password is incorrect.",
    "duplicate-email": "That login email is already in use.",
    "password-mismatch": "The new passwords do not match.",
    "not-found": "The credential account could not be found.",
    "invalid-name": "The display name is invalid.",
  };
  return messages[reason] ?? "The account change could not be completed.";
}

function success(message: string): AccountSecurityActionState {
  return { status: "success", message };
}

function error(message: string): AccountSecurityActionState {
  return { status: "error", message };
}

function bypassMessage(): AccountSecurityActionState {
  return error("Account changes require normal authentication; development bypass is active.");
}
