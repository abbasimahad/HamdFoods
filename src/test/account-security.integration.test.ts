import { afterAll, afterEach, describe, expect, it } from "vitest";

import { PrismaAccountSecurityRepository } from "@/server/access/prisma-account-security-repository";
import { PrismaAccessRepository } from "@/server/access/prisma-access-repository";
import { auth } from "@/server/auth/auth";
import { prisma } from "@/server/db/prisma";
import { PHASE27_ADMIN, PHASE27_VIEWER } from "@/test/test-environment";
import { resetManagedUserPassword } from "@/modules/access/application/manage-users";
import {
  listLocalRecoveryAccounts,
  recoverLocalAdministrativeAccount,
} from "@/modules/access/application/local-account-recovery";

describe("account security persistence", () => {
  const replacementPassword = "Replacement-Password-Test-Only!";
  afterAll(async () => prisma.$disconnect());
  afterEach(async () => {
    const admin = await prisma.user.findFirst({
      where: {
        email: {
          in: [PHASE27_ADMIN.email, "new.admin@example.test", "recovered.owner@example.test"],
        },
      },
      select: { id: true },
    });
    if (admin) {
      await prisma.session.deleteMany({ where: { userId: admin.id } });
      await prisma.user.update({
        where: { id: admin.id },
        data: { email: PHASE27_ADMIN.email, name: PHASE27_ADMIN.name },
      });
      const context = await auth.$context;
      const hash = await context.password.hash(PHASE27_ADMIN.password);
      await context.internalAdapter.updatePassword(admin.id, hash);
    }
    const viewer = await prisma.user.findUnique({
      where: { email: PHASE27_VIEWER.email },
      select: { id: true },
    });
    if (viewer) {
      await prisma.session.deleteMany({ where: { userId: viewer.id } });
      const context = await auth.$context;
      const hash = await context.password.hash(PHASE27_VIEWER.password);
      await context.internalAdapter.updatePassword(viewer.id, hash);
    }
  });

  it("changes a password through Better Auth hashing and invalidates every old session", async () => {
    // Defect caught: a password change could retain the old hash/session or alter RBAC state.
    const user = await prisma.user.findUniqueOrThrow({
      where: { email: PHASE27_ADMIN.email },
      include: { roles: { include: { role: true } } },
    });
    await auth.api.signInEmail({
      body: { email: PHASE27_ADMIN.email, password: PHASE27_ADMIN.password },
    });
    const repository = new PrismaAccountSecurityRepository();

    await expect(
      repository.changePassword(user.id, PHASE27_ADMIN.password, replacementPassword),
    ).resolves.toBe("updated");
    expect(await prisma.session.count({ where: { userId: user.id } })).toBe(0);
    await expect(
      auth.api.signInEmail({
        body: { email: PHASE27_ADMIN.email, password: PHASE27_ADMIN.password },
      }),
    ).rejects.toThrow();
    await expect(
      auth.api.signInEmail({
        body: { email: PHASE27_ADMIN.email, password: replacementPassword },
      }),
    ).resolves.toMatchObject({ user: { id: user.id } });
    expect(
      await prisma.user.findUniqueOrThrow({
        where: { id: user.id },
        include: { roles: { include: { role: true } } },
      }),
    ).toMatchObject({ active: user.active, roles: user.roles });
    const event = await prisma.auditEvent.findFirstOrThrow({
      where: { actorUserId: user.id, entityId: user.id, module: "account-security" },
      orderBy: { occurredAt: "desc" },
    });
    expect(event).toMatchObject({
      action: "LOGIN_SECURITY_EVENT",
      metadata: { event: "PASSWORD_CHANGED" },
    });
    expect(JSON.stringify(event)).not.toContain(PHASE27_ADMIN.password);
    expect(JSON.stringify(event)).not.toContain(replacementPassword);
  });

  it("updates the authenticated user's display name and records a non-secret profile event", async () => {
    // Defect caught: a profile update could be acknowledged without persisting or auditing it.
    const user = await prisma.user.findUniqueOrThrow({ where: { email: PHASE27_ADMIN.email } });
    const repository = new PrismaAccountSecurityRepository();

    await repository.updateDisplayName(user.id, "Factory Owner");

    await expect(prisma.user.findUniqueOrThrow({ where: { id: user.id } })).resolves.toMatchObject({
      name: "Factory Owner",
    });
    await expect(
      prisma.auditEvent.findFirst({
        where: { actorUserId: user.id, entityId: user.id, module: "account-security" },
        orderBy: { occurredAt: "desc" },
      }),
    ).resolves.toMatchObject({
      action: "UPDATE",
      metadata: { event: "PROFILE_UPDATED" },
    });
  });

  it("changes the login email after password confirmation, rejects duplicates, and revokes sessions", async () => {
    // Defect caught: an email change could leave the old login/session valid or accept another user's email.
    const user = await prisma.user.findUniqueOrThrow({
      where: { email: PHASE27_ADMIN.email },
      include: { roles: { include: { role: true } } },
    });
    await auth.api.signInEmail({
      body: { email: PHASE27_ADMIN.email, password: PHASE27_ADMIN.password },
    });
    expect(await prisma.session.count({ where: { userId: user.id } })).toBeGreaterThan(0);
    const repository = new PrismaAccountSecurityRepository();

    await expect(
      repository.changeLoginEmail(user.id, "new.admin@example.test", PHASE27_ADMIN.password),
    ).resolves.toBe("updated");

    await expect(
      auth.api.signInEmail({
        body: { email: PHASE27_ADMIN.email, password: PHASE27_ADMIN.password },
      }),
    ).rejects.toThrow();
    await expect(
      auth.api.signInEmail({
        body: { email: "new.admin@example.test", password: PHASE27_ADMIN.password },
      }),
    ).resolves.toMatchObject({ user: { id: user.id } });
    expect(await prisma.session.count({ where: { userId: user.id } })).toBe(1);
    expect(
      await prisma.user.findUniqueOrThrow({
        where: { id: user.id },
        include: { roles: { include: { role: true } } },
      }),
    ).toMatchObject({
      active: user.active,
      roles: user.roles,
    });
    await expect(
      repository.changeLoginEmail(user.id, PHASE27_VIEWER.email, PHASE27_ADMIN.password),
    ).resolves.toBe("duplicate-email");
    await expect(
      prisma.auditEvent.findFirst({
        where: { actorUserId: user.id, entityId: user.id, module: "account-security" },
        orderBy: { occurredAt: "desc" },
      }),
    ).resolves.toMatchObject({
      action: "LOGIN_SECURITY_EVENT",
      metadata: { event: "LOGIN_EMAIL_CHANGED" },
    });
  });

  it("allows an authorized admin to reset a target password while preserving target access", async () => {
    // Defect caught: an admin reset could leave old credentials/sessions valid or mutate target RBAC/status.
    const access = new PrismaAccessRepository();
    const actorRow = await prisma.user.findUniqueOrThrow({ where: { email: PHASE27_ADMIN.email } });
    const actor = await access.loadPrincipal(actorRow.id);
    if (!actor) throw new Error("Seeded administrator principal is missing.");
    const target = await prisma.user.findUniqueOrThrow({
      where: { email: PHASE27_VIEWER.email },
      include: { roles: { include: { role: true } } },
    });
    await auth.api.signInEmail({
      body: { email: PHASE27_VIEWER.email, password: PHASE27_VIEWER.password },
    });
    const repository = new PrismaAccountSecurityRepository();

    await expect(
      resetManagedUserPassword(actor, target.id, replacementPassword, repository),
    ).resolves.toEqual({ ok: true });
    expect(await prisma.session.count({ where: { userId: target.id } })).toBe(0);
    await expect(
      auth.api.signInEmail({
        body: { email: PHASE27_VIEWER.email, password: PHASE27_VIEWER.password },
      }),
    ).rejects.toThrow();
    await expect(
      auth.api.signInEmail({
        body: { email: PHASE27_VIEWER.email, password: replacementPassword },
      }),
    ).resolves.toMatchObject({ user: { id: target.id } });
    expect(
      await prisma.user.findUniqueOrThrow({
        where: { id: target.id },
        include: { roles: { include: { role: true } } },
      }),
    ).toMatchObject({ active: target.active, roles: target.roles });
    await expect(
      prisma.auditEvent.findFirst({
        where: { actorUserId: actor.id, entityId: target.id, module: "administration" },
        orderBy: { occurredAt: "desc" },
      }),
    ).resolves.toMatchObject({
      action: "LOGIN_SECURITY_EVENT",
      metadata: { event: "ADMIN_PASSWORD_RESET" },
    });
  });

  it("discovers active administrative accounts without exposing credential material", async () => {
    // Defect caught: offline discovery could omit the owner, include a viewer, or expose auth records.
    const repository = new PrismaAccountSecurityRepository();
    const accounts = await listLocalRecoveryAccounts(repository);

    expect(accounts).toHaveLength(1);
    expect(accounts[0]).toMatchObject({
      displayName: PHASE27_ADMIN.name,
      loginEmail: PHASE27_ADMIN.email,
      roleCodes: ["SUPER_ADMIN"],
      status: "Active",
    });
    expect(JSON.stringify(accounts)).not.toMatch(/password|hash|token|database_url|secret/i);
  });

  it("locally changes both owner credentials, revokes sessions, and preserves authorization", async () => {
    // Defect caught: offline recovery could leave an old credential/session valid or change owner access.
    const target = await prisma.user.findUniqueOrThrow({
      where: { email: PHASE27_ADMIN.email },
      include: { roles: { include: { role: true } } },
    });
    await auth.api.signInEmail({
      body: { email: PHASE27_ADMIN.email, password: PHASE27_ADMIN.password },
    });
    const repository = new PrismaAccountSecurityRepository();

    await expect(
      recoverLocalAdministrativeAccount(repository, {
        userId: target.id,
        loginEmail: "recovered.owner@example.test",
        password: replacementPassword,
        confirmedPassword: replacementPassword,
      }),
    ).resolves.toEqual({ ok: true });
    expect(await prisma.session.count({ where: { userId: target.id } })).toBe(0);
    await expect(
      auth.api.signInEmail({
        body: { email: PHASE27_ADMIN.email, password: PHASE27_ADMIN.password },
      }),
    ).rejects.toThrow();
    await expect(
      auth.api.signInEmail({
        body: { email: "recovered.owner@example.test", password: replacementPassword },
      }),
    ).resolves.toMatchObject({ user: { id: target.id } });
    expect(
      await prisma.user.findUniqueOrThrow({
        where: { id: target.id },
        include: { roles: { include: { role: true } } },
      }),
    ).toMatchObject({ active: target.active, roles: target.roles });
    await expect(
      prisma.auditEvent.findFirst({
        where: { actorUserId: target.id, entityId: target.id, module: "local-recovery" },
        orderBy: { occurredAt: "desc" },
      }),
    ).resolves.toMatchObject({
      action: "LOGIN_SECURITY_EVENT",
      metadata: { event: "LOCAL_ACCOUNT_RECOVERY", channel: "LOCAL_WINDOWS_ADMINISTRATOR" },
    });
  });
});
