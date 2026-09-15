"use server";

import { revalidatePath } from "next/cache";

import { requirePermission } from "@/server/auth/server-guards";
import { prisma } from "@/server/db/prisma";
import { recordAuditEvent } from "@/server/audit/audit-event";
import {
  generateActivationRequestForCurrentMachine,
  getLicenseStatus,
  importLicenseFileContent,
  resetCorruptedLocalState,
} from "@/server/licensing/license-service";
import { LicenseFileError } from "@/server/licensing/license-file-store";
import { MachineFingerprintError } from "@/server/licensing/machine-fingerprint";

// This module deliberately imports requirePermission from server-guards.ts
// (unrestricted), not licensed-guards.ts. License-management operations
// must remain available in every restricted license state -- otherwise an
// installation that becomes restricted could never recover (see the Phase
// 33 design, Sections 6 and 10). "license.manage" is the only gate here.
//
// Only these deliberate, actor-attributable operations are audited under
// LICENSE / "default". Passive state-machine transitions discovered during
// an ordinary page view (e.g. entering EXPIRY_GRACE, or CLOCK_ROLLBACK
// detected while a random authenticated user happens to load a page) have
// no specific responsible actor to attribute them to and are intentionally
// not force-fit into the actor-centric audit schema.

export type LicenseActionState = { ok: boolean; message: string };

export async function generateActivationRequestAction(): Promise<LicenseActionState> {
  await requirePermission("license.manage");
  try {
    const filePath = generateActivationRequestForCurrentMachine();
    revalidatePath("/administration/license");
    return { ok: true, message: `Activation request written to ${filePath}.` };
  } catch (error) {
    if (error instanceof MachineFingerprintError) return { ok: false, message: error.message };
    return { ok: false, message: "Could not generate an activation request." };
  }
}

export async function importLicenseFileAction(
  _state: LicenseActionState | undefined,
  formData: FormData,
): Promise<LicenseActionState> {
  const actor = await requirePermission("license.manage");
  const file = formData.get("licenseFile");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, message: "Choose a .lic file to import." };
  }
  if (file.size > 64 * 1024) {
    return { ok: false, message: "License file is unexpectedly large; import refused." };
  }
  try {
    const beforeState = getLicenseStatus().state;
    const content = await file.text();
    importLicenseFileContent(content);
    const afterState = getLicenseStatus({ forceRefresh: true }).state;
    await recordAuditEvent(prisma, {
      actorUserId: actor.id,
      action: "UPDATE",
      entityType: "LICENSE",
      entityId: "default",
      module: "administration",
      description: "Imported a signed license file.",
      metadata: { beforeState, afterState },
      controlEvent: true,
    });
    revalidatePath("/administration/license");
    revalidatePath("/", "layout");
    return { ok: true, message: "License imported." };
  } catch (error) {
    if (error instanceof LicenseFileError) return { ok: false, message: error.message };
    return { ok: false, message: "Could not import the license file." };
  }
}

export async function resetLocalLicenseStateAction(): Promise<LicenseActionState> {
  const actor = await requirePermission("license.manage");
  const beforeState = getLicenseStatus().state;
  resetCorruptedLocalState();
  const afterState = getLicenseStatus({ forceRefresh: true }).state;
  await recordAuditEvent(prisma, {
    actorUserId: actor.id,
    action: "OVERRIDE",
    entityType: "LICENSE",
    entityId: "default",
    module: "administration",
    description: "Reset local license state metadata.",
    reason: "Local license state was unreadable or failed integrity verification.",
    metadata: { beforeState, afterState },
    controlEvent: true,
  });
  revalidatePath("/administration/license");
  revalidatePath("/", "layout");
  return { ok: true, message: "Local license state was reset. Re-evaluating license status." };
}
