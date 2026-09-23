import { describeValidationIssue } from "@/server/shared/validation-message";
import { z } from "zod";
import type { ApplicationPrincipal } from "@/modules/access/domain/principal";
import { validateCompanyProfile } from "../domain/company-profile";
import {
  requireSettingsManager,
  type CompanyProfileMutationResult,
  type CompanyProfileRepository,
} from "./company-profile-contracts";

const optional = (max: number) => z.string().trim().max(max).optional();
const formSchema = z.object({
  legalName: z.string().trim().min(1).max(200),
  address: optional(500),
  city: optional(120),
  phone: optional(40),
  email: optional(200),
  taxRegistrationNo: optional(60),
});

export async function saveCompanyProfile(
  actor: ApplicationPrincipal,
  form: Record<string, unknown>,
  repository: CompanyProfileRepository,
): Promise<CompanyProfileMutationResult> {
  const denied = requireSettingsManager(actor);
  if (denied) return denied;
  const parsed = formSchema.safeParse({
    legalName: form.legalName,
    address: text(form.address),
    city: text(form.city),
    phone: text(form.phone),
    email: text(form.email),
    taxRegistrationNo: text(form.taxRegistrationNo),
  });
  if (!parsed.success)
    return {
      ok: false,
      message: describeValidationIssue(parsed.error.issues[0]) ?? "Invalid company profile.",
    };
  try {
    const validated = validateCompanyProfile(parsed.data);
    await repository.saveCompanyProfile({ ...validated, actorUserId: actor.id });
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "Company profile could not be saved.",
    };
  }
}

function text(value: unknown) {
  const result = String(value ?? "").trim();
  return result || undefined;
}
