import { describe, expect, it, vi } from "vitest";

import type { ApplicationPrincipal } from "@/modules/access/domain/principal";
import { saveCompanyProfile } from "./manage-company-profile";
import type { CompanyProfileRepository } from "./company-profile-contracts";

const actor: ApplicationPrincipal = {
  id: "00000000-0000-4000-8000-000000000001",
  active: true,
  email: "admin@example.com",
  name: "Administrator",
  roleCodes: ["ADMIN"],
  permissions: ["settings.manage"],
};

function repository(): CompanyProfileRepository {
  return {
    getCompanyProfile: vi.fn().mockResolvedValue({
      legalName: "Hamd Foods ERP",
      address: null,
      city: null,
      phone: null,
      email: null,
      taxRegistrationNo: null,
      updatedByName: null,
      updatedAt: new Date(),
    }),
    saveCompanyProfile: vi.fn(),
  };
}

describe("saveCompanyProfile", () => {
  it("saves a validated profile with the actor recorded", async () => {
    const repo = repository();
    const result = await saveCompanyProfile(
      actor,
      { legalName: "Hamd Foods (Pvt) Ltd", address: "12 Factory Road", city: "Lahore" },
      repo,
    );
    expect(result).toEqual({ ok: true });
    expect(repo.saveCompanyProfile).toHaveBeenCalledWith(
      expect.objectContaining({
        legalName: "Hamd Foods (Pvt) Ltd",
        address: "12 Factory Road",
        city: "Lahore",
        actorUserId: actor.id,
      }),
    );
  });

  it("requires settings.manage", async () => {
    const repo = repository();
    const result = await saveCompanyProfile(
      { ...actor, permissions: ["users.manage"] },
      { legalName: "Hamd Foods ERP" },
      repo,
    );
    expect(result).toEqual({ ok: false, message: "Settings management permission is required." });
    expect(repo.saveCompanyProfile).not.toHaveBeenCalled();
  });

  it("rejects a blank legal name", async () => {
    const repo = repository();
    const result = await saveCompanyProfile(actor, { legalName: "   " }, repo);
    expect(result.ok).toBe(false);
    expect(repo.saveCompanyProfile).not.toHaveBeenCalled();
  });

  it("rejects an invalid email", async () => {
    const repo = repository();
    const result = await saveCompanyProfile(
      actor,
      { legalName: "Hamd Foods ERP", email: "not-an-email" },
      repo,
    );
    expect(result.ok).toBe(false);
    expect(repo.saveCompanyProfile).not.toHaveBeenCalled();
  });
});
