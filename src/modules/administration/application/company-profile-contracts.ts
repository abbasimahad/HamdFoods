import type { ApplicationPrincipal } from "@/modules/access/domain/principal";

export type CompanyProfileRecord = {
  legalName: string;
  address: string | null;
  city: string | null;
  phone: string | null;
  email: string | null;
  taxRegistrationNo: string | null;
  updatedByName: string | null;
  updatedAt: Date;
};

export type SaveCompanyProfileInput = {
  legalName: string;
  address?: string | null | undefined;
  city?: string | null | undefined;
  phone?: string | null | undefined;
  email?: string | null | undefined;
  taxRegistrationNo?: string | null | undefined;
  actorUserId: string;
};

export type CompanyProfileMutationResult = { ok: true } | { ok: false; message: string };

export interface CompanyProfileRepository {
  getCompanyProfile(): Promise<CompanyProfileRecord>;
  saveCompanyProfile(input: SaveCompanyProfileInput): Promise<void>;
}

export function requireSettingsManager(
  actor: ApplicationPrincipal,
): CompanyProfileMutationResult | null {
  return actor.active && actor.permissions.includes("settings.manage")
    ? null
    : { ok: false, message: "Settings management permission is required." };
}
