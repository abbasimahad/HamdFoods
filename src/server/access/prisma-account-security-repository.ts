import "server-only";

import type { AccountSecurityStore } from "@/modules/access/application/manage-account-security";
import type { LocalAccountRecoveryStore } from "@/modules/access/application/local-account-recovery";
import type { PasswordResetStore } from "@/modules/access/application/manage-users";
import { auth } from "@/server/auth/auth";
import { recordAuditEvent } from "@/server/audit/audit-event";
import { prisma } from "@/server/db/prisma";

export class PrismaAccountSecurityRepository
  implements AccountSecurityStore, PasswordResetStore, LocalAccountRecoveryStore
{
  async updateDisplayName(actorId: string, displayName: string) {
    await prisma.$transaction(async (transaction) => {
      const before = await transaction.user.findUniqueOrThrow({
        where: { id: actorId },
        select: { name: true },
      });
      await transaction.user.update({ where: { id: actorId }, data: { name: displayName } });
      await recordAuditEvent(transaction, {
        actorUserId: actorId,
        action: "UPDATE",
        entityType: "USER",
        entityId: actorId,
        module: "account-security",
        description: "Updated account display name.",
        metadata: { event: "PROFILE_UPDATED" },
        beforeSnapshot: { name: before.name },
        afterSnapshot: { name: displayName },
        controlEvent: true,
      });
    });
  }

  async changeLoginEmail(actorId: string, newEmail: string, currentPassword: string) {
    const context = await auth.$context;
    const account = await context.internalAdapter.findCredentialAccount(actorId);
    if (!account?.password) return "not-found" as const;
    if (!(await context.password.verify({ hash: account.password, password: currentPassword }))) {
      return "invalid-current-password" as const;
    }
    const existing = await prisma.user.findUnique({
      where: { email: newEmail },
      select: { id: true },
    });
    if (existing && existing.id !== actorId) return "duplicate-email" as const;

    await prisma.$transaction(async (transaction) => {
      const before = await transaction.user.findUnique({
        where: { id: actorId },
        select: { email: true },
      });
      if (!before) throw new Error("The account no longer exists.");
      await transaction.user.update({ where: { id: actorId }, data: { email: newEmail } });
      await transaction.session.deleteMany({ where: { userId: actorId } });
      await recordAuditEvent(transaction, {
        actorUserId: actorId,
        action: "LOGIN_SECURITY_EVENT",
        entityType: "USER",
        entityId: actorId,
        entityReference: newEmail,
        module: "account-security",
        description: "Changed account login email and revoked existing sessions.",
        metadata: { event: "LOGIN_EMAIL_CHANGED" },
        beforeSnapshot: { email: before.email },
        afterSnapshot: { email: newEmail },
        controlEvent: true,
      });
    });
    return "updated" as const;
  }

  async changePassword(actorId: string, currentPassword: string, newPassword: string) {
    const context = await auth.$context;
    const account = await context.internalAdapter.findCredentialAccount(actorId);
    if (!account?.password) return "not-found" as const;
    if (!(await context.password.verify({ hash: account.password, password: currentPassword }))) {
      return "invalid-current-password" as const;
    }
    assertPasswordLength(newPassword, context.password.config);
    const hash = await context.password.hash(newPassword);
    await context.internalAdapter.updatePassword(actorId, hash);
    try {
      await prisma.$transaction(async (transaction) => {
        await transaction.session.deleteMany({ where: { userId: actorId } });
        await recordAuditEvent(transaction, {
          actorUserId: actorId,
          action: "LOGIN_SECURITY_EVENT",
          entityType: "USER",
          entityId: actorId,
          module: "account-security",
          description: "Changed account password and revoked existing sessions.",
          metadata: { event: "PASSWORD_CHANGED" },
          controlEvent: true,
        });
      });
    } catch (error) {
      await context.internalAdapter.deleteUserSessions(actorId).catch(() => undefined);
      throw error;
    }
    return "updated" as const;
  }

  async getUserAccessState(userId: string) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { active: true, roles: { select: { role: { select: { code: true } } } } },
    });
    return user
      ? { active: user.active, roleCodes: user.roles.map(({ role }) => role.code) }
      : null;
  }

  async resetUserPassword(actorId: string, userId: string, newPassword: string) {
    const context = await auth.$context;
    const account = await context.internalAdapter.findCredentialAccount(userId);
    if (!account) throw new Error("The target credential account no longer exists.");
    assertPasswordLength(newPassword, context.password.config);
    const hash = await context.password.hash(newPassword);
    await context.internalAdapter.updatePassword(userId, hash);
    try {
      await prisma.$transaction(async (transaction) => {
        await transaction.session.deleteMany({ where: { userId } });
        await recordAuditEvent(transaction, {
          actorUserId: actorId,
          action: "LOGIN_SECURITY_EVENT",
          entityType: "USER",
          entityId: userId,
          module: "administration",
          description: "An administrator reset a managed-user password and revoked its sessions.",
          metadata: { event: "ADMIN_PASSWORD_RESET" },
          controlEvent: true,
        });
      });
    } catch (error) {
      await context.internalAdapter.deleteUserSessions(userId).catch(() => undefined);
      throw error;
    }
  }

  async listAdministrativeAccounts() {
    const users = await prisma.user.findMany({
      where: {
        active: true,
        roles: {
          some: {
            role: {
              OR: [
                { code: "SUPER_ADMIN" },
                { permissions: { some: { permission: { code: "users.manage" } } } },
              ],
            },
          },
        },
      },
      orderBy: [{ name: "asc" }, { email: "asc" }],
      select: {
        id: true,
        name: true,
        email: true,
        roles: { select: { role: { select: { code: true } } }, orderBy: { role: { code: "asc" } } },
      },
    });
    return users.map((user) => ({
      id: user.id,
      displayName: user.name,
      loginEmail: user.email,
      roleCodes: user.roles.map(({ role }) => role.code),
      status: "Active" as const,
    }));
  }

  async recoverAdministrativeAccount(
    userId: string,
    changes: { loginEmail?: string; password?: string },
  ) {
    const target = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        active: true,
        email: true,
        roles: {
          select: {
            role: {
              select: {
                code: true,
                permissions: { select: { permission: { select: { code: true } } } },
              },
            },
          },
        },
      },
    });
    if (!target) return "not-found" as const;
    const administrative = target.roles.some(
      ({ role }) =>
        role.code === "SUPER_ADMIN" ||
        role.permissions.some(({ permission }) => permission.code === "users.manage"),
    );
    if (!target.active || !administrative) return "not-administrative" as const;
    if (changes.loginEmail) {
      const existing = await prisma.user.findUnique({
        where: { email: changes.loginEmail },
        select: { id: true },
      });
      if (existing && existing.id !== userId) return "duplicate-email" as const;
    }

    const context = await auth.$context;
    if (changes.password) {
      const account = await context.internalAdapter.findCredentialAccount(userId);
      if (!account) return "not-found" as const;
      assertPasswordLength(changes.password, context.password.config);
      const hash = await context.password.hash(changes.password);
      await context.internalAdapter.updatePassword(userId, hash);
    }
    try {
      await prisma.$transaction(async (transaction) => {
        if (changes.loginEmail) {
          await transaction.user.update({
            where: { id: userId },
            data: { email: changes.loginEmail },
          });
        }
        await transaction.session.deleteMany({ where: { userId } });
        await recordAuditEvent(transaction, {
          actorUserId: userId,
          action: "LOGIN_SECURITY_EVENT",
          entityType: "USER",
          entityId: userId,
          entityReference: changes.loginEmail ?? target.email,
          module: "local-recovery",
          description:
            "A local Windows Administrator recovered an administrative account and revoked its sessions.",
          metadata: {
            event: "LOCAL_ACCOUNT_RECOVERY",
            channel: "LOCAL_WINDOWS_ADMINISTRATOR",
            changes: [
              ...(changes.loginEmail ? ["LOGIN_EMAIL"] : []),
              ...(changes.password ? ["PASSWORD"] : []),
            ],
          },
          beforeSnapshot: { email: target.email },
          afterSnapshot: { email: changes.loginEmail ?? target.email },
          controlEvent: true,
        });
      });
    } catch (error) {
      await context.internalAdapter.deleteUserSessions(userId).catch(() => undefined);
      throw error;
    }
    return "updated" as const;
  }
}

function assertPasswordLength(
  password: string,
  config: { minPasswordLength: number; maxPasswordLength: number },
) {
  if (password.length < config.minPasswordLength || password.length > config.maxPasswordLength) {
    throw new Error("The password does not meet the configured length requirements.");
  }
}
