import { describe, expect, it } from "vitest";

import { prisma } from "@/server/db/prisma";
import { PrismaCompanyProfileRepository } from "@/server/administration/prisma-company-profile-repository";
import { executePhase27GoldenWorkflow } from "./phase27-golden-workflow";

const repo = new PrismaCompanyProfileRepository();

describe("company profile", () => {
  it("is seeded with the default legal name and is a true singleton", async () => {
    const before = await repo.getCompanyProfile();
    expect(before.legalName).toBe("Hamd Foods ERP");
    const count = await prisma.companyProfile.count();
    expect(count).toBe(1);
  });

  it("saves updates, records one audit event with before/after snapshots, and never creates a second row", async () => {
    const state = await executePhase27GoldenWorkflow();
    const auditBefore = await prisma.auditEvent.count({ where: { entityType: "COMPANY_PROFILE" } });

    await repo.saveCompanyProfile({
      legalName: "Hamd Foods (Pvt) Ltd",
      address: "12 Factory Road",
      city: "Lahore",
      phone: "+92 300 1234567",
      email: "info@hamdfoods.example",
      taxRegistrationNo: "NTN-1234567-8",
      actorUserId: state.actorUserId,
    });

    const after = await repo.getCompanyProfile();
    expect(after).toMatchObject({
      legalName: "Hamd Foods (Pvt) Ltd",
      address: "12 Factory Road",
      city: "Lahore",
      phone: "+92 300 1234567",
      email: "info@hamdfoods.example",
      taxRegistrationNo: "NTN-1234567-8",
    });
    expect(after.updatedByName).toBeTruthy();
    expect(await prisma.companyProfile.count()).toBe(1);

    const auditEvent = await prisma.auditEvent.findFirstOrThrow({
      where: { entityType: "COMPANY_PROFILE" },
      orderBy: { createdAt: "desc" },
    });
    expect(auditEvent.action).toBe("UPDATE");
    expect(auditEvent.entityId).toBe("default");
    expect(auditEvent.module).toBe("administration");
    expect(auditEvent.controlEvent).toBe(true);
    expect(auditEvent.afterSnapshot).toMatchObject({ legalName: "Hamd Foods (Pvt) Ltd" });
    expect(await prisma.auditEvent.count({ where: { entityType: "COMPANY_PROFILE" } })).toBe(
      auditBefore + 1,
    );

    // Immutability of the audit trail itself (existing append-only trigger).
    await expect(
      prisma.auditEvent.update({ where: { id: auditEvent.id }, data: { description: "tampered" } }),
    ).rejects.toThrow();

    // Restore the default so other tests observing this table are unaffected.
    await repo.saveCompanyProfile({ legalName: "Hamd Foods ERP", actorUserId: state.actorUserId });
  });

  it("does not touch inventory, valuation, accounting, or RBAC state", async () => {
    const state = await executePhase27GoldenWorkflow();
    const [movements, valuations, journals, mappings, rolePermissions] = await Promise.all([
      prisma.inventoryMovement.count(),
      prisma.inventoryValuationEntry.count(),
      prisma.accountingJournal.count(),
      prisma.accountingAccountMapping.count(),
      prisma.rolePermission.count(),
    ]);

    await repo.saveCompanyProfile({
      legalName: "Scope Boundary Test Co",
      actorUserId: state.actorUserId,
    });

    expect(await prisma.inventoryMovement.count()).toBe(movements);
    expect(await prisma.inventoryValuationEntry.count()).toBe(valuations);
    expect(await prisma.accountingJournal.count()).toBe(journals);
    expect(await prisma.accountingAccountMapping.count()).toBe(mappings);
    expect(await prisma.rolePermission.count()).toBe(rolePermissions);

    await repo.saveCompanyProfile({ legalName: "Hamd Foods ERP", actorUserId: state.actorUserId });
  });
});
