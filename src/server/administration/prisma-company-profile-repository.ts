import "server-only";

import type {
  CompanyProfileRecord,
  CompanyProfileRepository,
  SaveCompanyProfileInput,
} from "@/modules/administration/application/company-profile-contracts";
import { prisma } from "@/server/db/prisma";
import { recordAuditEvent } from "@/server/audit/audit-event";

const DEFAULT_LEGAL_NAME = "Hamd Foods ERP";

export class PrismaCompanyProfileRepository implements CompanyProfileRepository {
  async getCompanyProfile(): Promise<CompanyProfileRecord> {
    const row = await prisma.companyProfile.findUnique({
      where: { id: "default" },
      include: { updatedBy: true },
    });
    if (!row)
      return {
        legalName: DEFAULT_LEGAL_NAME,
        address: null,
        city: null,
        phone: null,
        email: null,
        taxRegistrationNo: null,
        updatedByName: null,
        updatedAt: new Date(0),
      };
    return {
      legalName: row.legalName,
      address: row.address,
      city: row.city,
      phone: row.phone,
      email: row.email,
      taxRegistrationNo: row.taxRegistrationNo,
      updatedByName: row.updatedBy?.name ?? null,
      updatedAt: row.updatedAt,
    };
  }

  async saveCompanyProfile(input: SaveCompanyProfileInput): Promise<void> {
    await prisma.$transaction(async (tx) => {
      const before = await tx.companyProfile.findUnique({ where: { id: "default" } });
      const data = {
        legalName: input.legalName,
        address: input.address ?? null,
        city: input.city ?? null,
        phone: input.phone ?? null,
        email: input.email ?? null,
        taxRegistrationNo: input.taxRegistrationNo ?? null,
        updatedByUserId: input.actorUserId,
      };
      await tx.companyProfile.upsert({
        where: { id: "default" },
        create: { id: "default", ...data },
        update: data,
      });
      await recordAuditEvent(tx, {
        actorUserId: input.actorUserId,
        action: "UPDATE",
        entityType: "COMPANY_PROFILE",
        entityId: "default",
        entityReference: input.legalName,
        module: "administration",
        description: "Updated company/factory profile.",
        beforeSnapshot: before
          ? {
              legalName: before.legalName,
              address: before.address,
              city: before.city,
              phone: before.phone,
              email: before.email,
              taxRegistrationNo: before.taxRegistrationNo,
            }
          : null,
        afterSnapshot: data,
        controlEvent: true,
      });
    });
  }
}
