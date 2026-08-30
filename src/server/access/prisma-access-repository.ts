import "server-only";

import type { ApplicationPrincipal } from "@/modules/access/domain/principal";
import { isPermissionCode, type PermissionCode } from "@/modules/access/domain/permissions";
import type { ManagedUserInput, UserAccessState } from "@/modules/access/application/manage-users";
import type {
  AccessSeedStore,
  BootstrapStore,
  BootstrapUser,
} from "@/modules/access/application/ports";
import { provisioningAuth } from "@/server/auth/auth";
import { recordAuditEvent } from "@/server/audit/audit-event";
import { prisma } from "@/server/db/prisma";

export class PrismaAccessRepository implements AccessSeedStore, BootstrapStore {
  async listUsers() {
    return prisma.user.findMany({
      orderBy: [{ name: "asc" }, { email: "asc" }],
      select: {
        id: true,
        name: true,
        email: true,
        active: true,
        createdAt: true,
        roles: { select: { role: { select: { code: true, name: true } } } },
      },
    });
  }

  async listRoles() {
    return prisma.role.findMany({
      orderBy: { name: "asc" },
      select: {
        code: true,
        name: true,
        isProtected: true,
        permissions: { select: { permission: { select: { code: true } } } },
      },
    });
  }

  async roleCodesExist(roleCodes: readonly string[]) {
    const uniqueCodes = [...new Set(roleCodes)];
    return (
      (await prisma.role.count({ where: { code: { in: uniqueCodes } } })) === uniqueCodes.length
    );
  }

  async roleExists(roleCode: string) {
    return (await prisma.role.count({ where: { code: roleCode } })) === 1;
  }

  async createUser(actorId: string, input: ManagedUserInput) {
    const created = await provisioningAuth.api.signUpEmail({
      body: { name: input.name, email: input.email, password: input.password },
    });
    try {
      const roles = await prisma.role.findMany({
        where: { code: { in: [...input.roleCodes] } },
        select: { id: true },
      });
      if (roles.length !== input.roleCodes.length)
        throw new Error("A selected role no longer exists");
      await prisma.$transaction(async (transaction) => {
        await transaction.user.update({
          where: { id: created.user.id },
          data: { active: input.active },
        });
        await transaction.userRole.createMany({
          data: roles.map((role) => ({ userId: created.user.id, roleId: role.id })),
          skipDuplicates: true,
        });
        if (!input.active)
          await transaction.session.deleteMany({ where: { userId: created.user.id } });
        await recordAuditEvent(transaction, {
          actorUserId: actorId,
          action: "CREATE",
          entityType: "USER",
          entityId: created.user.id,
          entityReference: created.user.email,
          module: "administration",
          description: `Created managed user ${created.user.email}.`,
          metadata: { roleCodes: input.roleCodes },
          afterSnapshot: { active: input.active, email: created.user.email },
          controlEvent: true,
        });
      });
    } catch (error) {
      await prisma.$transaction([
        prisma.user.update({ where: { id: created.user.id }, data: { active: false } }),
        prisma.session.deleteMany({ where: { userId: created.user.id } }),
      ]);
      throw error;
    }
    return { id: created.user.id, email: created.user.email };
  }

  async replaceUserRolesPreservingSuperAdmin(
    actorId: string,
    userId: string,
    roleCodes: readonly string[],
  ) {
    return prisma.$transaction(
      async (transaction) => {
        const [actor, target] = await Promise.all([
          transaction.user.findUnique({
            where: { id: actorId },
            select: { roles: { select: { role: { select: { code: true } } } } },
          }),
          transaction.user.findUnique({
            where: { id: userId },
            select: { active: true, roles: { select: { role: { select: { code: true } } } } },
          }),
        ]);
        if (!target) return "not-found" as const;
        const actorIsSuperAdmin =
          actor?.roles.some(({ role }) => role.code === "SUPER_ADMIN") ?? false;
        const touchesSuperAdmin =
          target.roles.some(({ role }) => role.code === "SUPER_ADMIN") ||
          roleCodes.includes("SUPER_ADMIN");
        if (touchesSuperAdmin && !actorIsSuperAdmin) return "protected-role" as const;
        const removesSuperAdmin =
          target?.active &&
          target.roles.some(({ role }) => role.code === "SUPER_ADMIN") &&
          !roleCodes.includes("SUPER_ADMIN");
        if (removesSuperAdmin) {
          const activeSuperAdmins = await transaction.user.count({
            where: { active: true, roles: { some: { role: { code: "SUPER_ADMIN" } } } },
          });
          if (activeSuperAdmins <= 1) return "last-super-admin" as const;
        }
        const roles = await transaction.role.findMany({
          where: { code: { in: [...roleCodes] } },
          select: { id: true },
        });
        await transaction.userRole.deleteMany({ where: { userId } });
        await transaction.userRole.createMany({
          data: roles.map((role) => ({ userId, roleId: role.id })),
          skipDuplicates: true,
        });
        await recordAuditEvent(transaction, {
          actorUserId: actorId,
          action: "UPDATE",
          entityType: "USER",
          entityId: userId,
          module: "administration",
          description: "Replaced managed-user role assignments.",
          metadata: {
            beforeRoleCodes: target.roles.map(({ role }) => role.code),
            afterRoleCodes: roleCodes,
          },
          controlEvent: true,
        });
        return "updated" as const;
      },
      { isolationLevel: "Serializable" },
    );
  }

  async getUserAccessState(userId: string): Promise<UserAccessState | null> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { active: true, roles: { select: { role: { select: { code: true } } } } },
    });
    return user
      ? { active: user.active, roleCodes: user.roles.map(({ role }) => role.code) }
      : null;
  }

  async setUserActivePreservingSuperAdmin(actorId: string, userId: string, active: boolean) {
    return prisma.$transaction(
      async (transaction) => {
        const [actor, target] = await Promise.all([
          transaction.user.findUnique({
            where: { id: actorId },
            select: { roles: { select: { role: { select: { code: true } } } } },
          }),
          transaction.user.findUnique({
            where: { id: userId },
            select: { active: true, roles: { select: { role: { select: { code: true } } } } },
          }),
        ]);
        if (!target) return "not-found" as const;
        const targetIsSuperAdmin = target.roles.some(({ role }) => role.code === "SUPER_ADMIN");
        const actorIsSuperAdmin =
          actor?.roles.some(({ role }) => role.code === "SUPER_ADMIN") ?? false;
        if (targetIsSuperAdmin && !actorIsSuperAdmin) return "protected-role" as const;
        if (!active && target?.active && targetIsSuperAdmin) {
          const activeSuperAdmins = await transaction.user.count({
            where: { active: true, roles: { some: { role: { code: "SUPER_ADMIN" } } } },
          });
          if (activeSuperAdmins <= 1) return "last-super-admin" as const;
        }
        await transaction.user.update({ where: { id: userId }, data: { active } });
        if (!active) await transaction.session.deleteMany({ where: { userId } });
        await recordAuditEvent(transaction, {
          actorUserId: actorId,
          action: active ? "ACTIVATE" : "DEACTIVATE",
          entityType: "USER",
          entityId: userId,
          module: "administration",
          description: `${active ? "Activated" : "Deactivated"} a managed user.`,
          beforeSnapshot: { active: target.active },
          afterSnapshot: { active },
          controlEvent: true,
        });
        return "updated" as const;
      },
      { isolationLevel: "Serializable" },
    );
  }
  async loadPrincipal(userId: string): Promise<ApplicationPrincipal | null> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        email: true,
        active: true,
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
    if (!user) return null;

    const permissions = new Set<PermissionCode>();
    for (const membership of user.roles) {
      for (const mapping of membership.role.permissions) {
        if (isPermissionCode(mapping.permission.code)) permissions.add(mapping.permission.code);
      }
    }
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      active: user.active,
      roleCodes: user.roles.map((membership) => membership.role.code),
      permissions: [...permissions],
    };
  }

  async revokeUserSessions(userId: string) {
    await prisma.session.deleteMany({ where: { userId } });
  }
  async upsertPermission(input: { code: PermissionCode; description: string }) {
    await prisma.permission.upsert({
      where: { code: input.code },
      create: input,
      update: { description: input.description },
    });
  }

  async upsertRole(input: { code: string; name: string; isProtected: boolean }) {
    await prisma.role.upsert({
      where: { code: input.code },
      create: { ...input, isSystem: true },
      update: { name: input.name, isSystem: true, isProtected: input.isProtected },
    });
  }

  async replaceRolePermissions(
    roleCode: string,
    permissionCodes: readonly PermissionCode[],
  ): Promise<void>;
  async replaceRolePermissions(
    actorId: string,
    roleCode: string,
    permissionCodes: readonly PermissionCode[],
  ): Promise<void>;
  async replaceRolePermissions(
    actorOrRoleCode: string,
    roleOrPermissionCodes: string | readonly PermissionCode[],
    submittedPermissionCodes?: readonly PermissionCode[],
  ) {
    const actorId = submittedPermissionCodes ? actorOrRoleCode : null;
    const roleCode = submittedPermissionCodes ? (roleOrPermissionCodes as string) : actorOrRoleCode;
    const permissionCodes = submittedPermissionCodes ?? (roleOrPermissionCodes as PermissionCode[]);
    const role = await prisma.role.findUniqueOrThrow({ where: { code: roleCode } });
    const permissions = await prisma.permission.findMany({
      where: { code: { in: [...permissionCodes] } },
      select: { id: true },
    });
    if (permissions.length !== permissionCodes.length) {
      throw new Error(`Cannot seed unknown permissions for role ${roleCode}`);
    }
    await prisma.$transaction(async (transaction) => {
      const before = actorId
        ? await transaction.rolePermission.findMany({
            where: { roleId: role.id },
            select: { permission: { select: { code: true } } },
          })
        : [];
      await transaction.rolePermission.deleteMany({ where: { roleId: role.id } });
      await transaction.rolePermission.createMany({
        data: permissions.map((permission) => ({
          roleId: role.id,
          permissionId: permission.id,
        })),
        skipDuplicates: true,
      });
      if (actorId)
        await recordAuditEvent(transaction, {
          actorUserId: actorId,
          action: "UPDATE",
          entityType: "ROLE",
          entityId: role.id,
          entityReference: role.code,
          module: "administration",
          description: `Replaced permissions for role ${role.code}.`,
          metadata: {
            beforePermissionCodes: before.map((row) => row.permission.code),
            afterPermissionCodes: permissionCodes,
          },
          controlEvent: true,
        });
    });
  }

  async findUserByEmail(email: string): Promise<BootstrapUser | null> {
    return prisma.user.findUnique({
      where: { email },
      select: { id: true, email: true, active: true },
    });
  }

  async createCredentialUser(input: {
    name: string;
    email: string;
    password: string;
  }): Promise<BootstrapUser> {
    const created = await provisioningAuth.api.signUpEmail({ body: input });
    return { id: created.user.id, email: created.user.email, active: true };
  }

  async setUserActive(userId: string, active: boolean) {
    await prisma.user.update({ where: { id: userId }, data: { active } });
  }

  async ensureUserRole(userId: string, roleCode: string) {
    const role = await prisma.role.findUniqueOrThrow({ where: { code: roleCode } });
    await prisma.userRole.upsert({
      where: { userId_roleId: { userId, roleId: role.id } },
      create: { userId, roleId: role.id },
      update: {},
    });
  }
}
