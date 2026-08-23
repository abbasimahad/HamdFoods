import "server-only";

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import type { PermissionCode } from "@/modules/access/domain/permissions";
import { hasPermission, type ApplicationPrincipal } from "@/modules/access/domain/principal";
import { PrismaAccessRepository } from "@/server/access/prisma-access-repository";

import { auth } from "./auth";
import { resolveCurrentPrincipal } from "./current-principal";

const repository = new PrismaAccessRepository();

export async function getCurrentPrincipal(): Promise<ApplicationPrincipal | null> {
  const session = await auth.api.getSession({ headers: await headers() });
  const resolution = await resolveCurrentPrincipal(
    session ? { userId: session.user.id } : null,
    repository,
  );
  return resolution.kind === "active" ? resolution.principal : null;
}

export async function requireUser(): Promise<ApplicationPrincipal> {
  const principal = await getCurrentPrincipal();
  if (!principal) redirect("/login");
  return principal;
}

export async function requirePermission(permission: PermissionCode): Promise<ApplicationPrincipal> {
  const principal = await requireUser();
  if (!hasPermission(principal, permission)) redirect("/access-denied");
  return principal;
}

export async function requireAnyPermission(
  permissions: readonly PermissionCode[],
): Promise<ApplicationPrincipal> {
  const principal = await requireUser();
  if (!permissions.some((permission) => hasPermission(principal, permission))) {
    redirect("/access-denied");
  }
  return principal;
}
