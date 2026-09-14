import type { CompanyProfileRecord } from "@/modules/administration/application/company-profile-contracts";

/**
 * Presentation-only company identity block for printed documents. Always
 * renders the current saved profile at print time (matching how supplier
 * and customer identity are already rendered live, not frozen per
 * document). Carries no transactional, financial, or authority data.
 */
export function PrintCompanyHeader({ profile }: { profile: CompanyProfileRecord }) {
  const contactParts = [profile.phone, profile.email].filter(Boolean);
  return (
    <div className="mb-4 border-b pb-3 text-sm">
      <p className="text-lg font-bold">{profile.legalName}</p>
      {(profile.address || profile.city) && (
        <p>{[profile.address, profile.city].filter(Boolean).join(", ")}</p>
      )}
      {contactParts.length > 0 && <p>{contactParts.join(" · ")}</p>}
      {profile.taxRegistrationNo && <p>Tax registration: {profile.taxRegistrationNo}</p>}
    </div>
  );
}
