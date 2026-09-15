import { redirect } from "next/navigation";

import type { PermissionCode } from "@/modules/access/domain/permissions";
import type { ApplicationPrincipal } from "@/modules/access/domain/principal";
import { getLicenseStatus } from "@/server/licensing/license-service";

import { requireAnyPermission as requireAnyPermissionUnrestricted } from "./server-guards";
import { requirePermission as requirePermissionUnrestricted } from "./server-guards";

/**
 * License-gated variants of server-guards.ts's requirePermission /
 * requireAnyPermission, for use only from actions.ts files -- i.e. server
 * actions that mutate business data. page.tsx files must keep importing
 * the unrestricted originals from "./server-guards" directly, so that every
 * read-only page remains available regardless of license state (see the
 * Phase 33 design, Section 6: restricted mode blocks mutations only).
 *
 * Authorization is still checked first with the exact same permission
 * semantics as before; only a permitted user reaching an unlicensed/
 * restricted installation is redirected to the license panel instead of
 * having their mutation proceed. The Administration -> License route's own
 * actions.ts intentionally imports the unrestricted originals instead of
 * this module, because license-management operations must remain available
 * in every restricted state (see the Phase 33 design, Sections 6 and 10).
 */
export async function requirePermission(permission: PermissionCode): Promise<ApplicationPrincipal> {
  const actor = await requirePermissionUnrestricted(permission);
  assertMutationAllowed();
  return actor;
}

export async function requireAnyPermission(
  permissions: readonly PermissionCode[],
): Promise<ApplicationPrincipal> {
  const actor = await requireAnyPermissionUnrestricted(permissions);
  assertMutationAllowed();
  return actor;
}

function assertMutationAllowed(): void {
  const status = getLicenseStatus();
  if (!status.mutationAllowed) redirect("/administration/license");
}
