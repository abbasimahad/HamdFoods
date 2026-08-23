import type { ApplicationPrincipal } from "@/modules/access/domain/principal";

export type PrincipalResolution =
  | { kind: "unauthenticated" }
  | { kind: "inactive" }
  | { kind: "active"; principal: ApplicationPrincipal };

export type PrincipalResolutionDependencies = {
  loadPrincipal(userId: string): Promise<ApplicationPrincipal | null>;
  revokeUserSessions(userId: string): Promise<void>;
};

export async function resolveCurrentPrincipal(
  session: { userId: string } | null,
  dependencies: PrincipalResolutionDependencies,
): Promise<PrincipalResolution> {
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
