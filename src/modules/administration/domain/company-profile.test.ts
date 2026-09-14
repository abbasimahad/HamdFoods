import { describe, expect, it } from "vitest";
import { CompanyProfileDomainError, validateCompanyProfile } from "./company-profile";

describe("validateCompanyProfile", () => {
  it("accepts a minimal profile with only a legal name", () => {
    expect(validateCompanyProfile({ legalName: "  Hamd Foods ERP  " })).toEqual({
      legalName: "Hamd Foods ERP",
      address: null,
      city: null,
      phone: null,
      email: null,
      taxRegistrationNo: null,
    });
  });

  it("accepts a fully populated profile", () => {
    expect(
      validateCompanyProfile({
        legalName: "Hamd Foods (Pvt) Ltd",
        address: "12 Factory Road",
        city: "Lahore",
        phone: "+92 300 1234567",
        email: "info@hamdfoods.example",
        taxRegistrationNo: "NTN-1234567-8",
      }),
    ).toEqual({
      legalName: "Hamd Foods (Pvt) Ltd",
      address: "12 Factory Road",
      city: "Lahore",
      phone: "+92 300 1234567",
      email: "info@hamdfoods.example",
      taxRegistrationNo: "NTN-1234567-8",
    });
  });

  it("rejects a blank legal name", () => {
    expect(() => validateCompanyProfile({ legalName: "   " })).toThrow(CompanyProfileDomainError);
  });

  it("rejects a legal name over 200 characters", () => {
    expect(() => validateCompanyProfile({ legalName: "x".repeat(201) })).toThrow(/200 characters/);
  });

  it("rejects an invalid email address", () => {
    expect(() =>
      validateCompanyProfile({ legalName: "Hamd Foods ERP", email: "not-an-email" }),
    ).toThrow(/valid email/);
  });

  it("treats blank optional fields as absent rather than empty strings", () => {
    expect(
      validateCompanyProfile({ legalName: "Hamd Foods ERP", address: "   ", phone: "" }),
    ).toMatchObject({ address: null, phone: null });
  });

  it("rejects an address over 500 characters", () => {
    expect(() =>
      validateCompanyProfile({ legalName: "Hamd Foods ERP", address: "x".repeat(501) }),
    ).toThrow(/500 characters/);
  });
});
