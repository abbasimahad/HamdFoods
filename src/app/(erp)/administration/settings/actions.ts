"use server";

import { revalidatePath } from "next/cache";
import { saveCompanyProfile } from "@/modules/administration/application/manage-company-profile";
import type { CompanyProfileMutationResult } from "@/modules/administration/application/company-profile-contracts";
import { requirePermission } from "@/server/auth/server-guards";
import { PrismaCompanyProfileRepository } from "@/server/administration/prisma-company-profile-repository";

const repository = new PrismaCompanyProfileRepository();

export async function saveCompanyProfileAction(
  _state: CompanyProfileMutationResult | undefined,
  formData: FormData,
): Promise<CompanyProfileMutationResult> {
  const actor = await requirePermission("settings.manage");
  const result = await saveCompanyProfile(actor, Object.fromEntries(formData), repository);
  if (result.ok) {
    revalidatePath("/administration/settings");
    revalidatePath("/", "layout");
  }
  return result;
}
