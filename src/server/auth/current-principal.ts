import type { ApplicationPrincipal } from "@/modules/access/domain/principal";
import { DEFAULT_ROLE_PERMISSIONS } from "@/modules/access/domain/default-roles";

export type PrincipalResolution =
  | { kind: "unauthenticated" }
  | { kind: "inactive" }
  | { kind: "active"; principal: ApplicationPrincipal };

export type PrincipalResolutionDependencies = {
  loadPrincipal(userId: string): Promise<ApplicationPrincipal | null>;
  revokeUserSessions(userId: string): Promise<void>;
};

export const DEVELOPMENT_AUTH_BYPASS_PRINCIPAL: ApplicationPrincipal = {
  id: "dev-auth-bypass",
  name: "Development Factory Owner",
  email: "dev-auth-bypass@hamdfoods.local",
  active: true,
  roleCodes: ["SUPER_ADMIN"],
  permissions: DEFAULT_ROLE_PERMISSIONS.SUPER_ADMIN,
};

export async function resolveCurrentPrincipal(
  session: { userId: string } | null,
  dependencies: PrincipalResolutionDependencies,
  options: { authenticationBypassEnabled?: boolean } = {},
): Promise<PrincipalResolution> {
  if (options.authenticationBypassEnabled) {
    return { kind: "active", principal: DEVELOPMENT_AUTH_BYPASS_PRINCIPAL };
  }

  if (!session) {
    return { kind: "unauthenticated" };
  }

  const principal = await dependencies.loadPrincipal(session.userId);

  if (!principal?.active) {
    await dependencies.revokeUserSessions(session.userId);
    return { kind: "inactive" };
  }

  return { kind: "active", principal };
}
