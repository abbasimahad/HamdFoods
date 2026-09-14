export class CompanyProfileDomainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CompanyProfileDomainError";
  }
}

export type CompanyProfileInput = {
  legalName: string;
  address?: string | null | undefined;
  city?: string | null | undefined;
  phone?: string | null | undefined;
  email?: string | null | undefined;
  taxRegistrationNo?: string | null | undefined;
};

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Presentation-only identity for printed documents and in-app branding.
 * Deliberately has no bearing on inventory, valuation, accounting mappings,
 * accounting periods, RBAC, posted documents, production costing, or tax
 * authority -- none of those are readable or writable through this type.
 */
export function validateCompanyProfile(input: {
  legalName: string;
  address?: string | undefined;
  city?: string | undefined;
  phone?: string | undefined;
  email?: string | undefined;
  taxRegistrationNo?: string | undefined;
}): CompanyProfileInput {
  const legalName = input.legalName.trim();
  if (!legalName) throw new CompanyProfileDomainError("Legal name is required.");
  if (legalName.length > 200)
    throw new CompanyProfileDomainError("Legal name must be 200 characters or fewer.");

  const address = optional(input.address, 500, "Address");
  const city = optional(input.city, 120, "City");
  const phone = optional(input.phone, 40, "Phone");
  const taxRegistrationNo = optional(input.taxRegistrationNo, 60, "Tax registration number");

  const email = optional(input.email, 200, "Email");
  if (email && !EMAIL_PATTERN.test(email))
    throw new CompanyProfileDomainError("Email is not a valid email address.");

  return { legalName, address, city, phone, email, taxRegistrationNo };
}

function optional(value: string | undefined, maxLength: number, label: string) {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  if (trimmed.length > maxLength)
    throw new CompanyProfileDomainError(`${label} must be ${maxLength} characters or fewer.`);
  return trimmed;
}
