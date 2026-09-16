"use server";

import { revalidatePath } from "next/cache";

import { requirePermission } from "@/server/auth/server-guards";
import { prisma } from "@/server/db/prisma";
import { recordAuditEvent } from "@/server/audit/audit-event";
import {
  armUpdate,
  UpdateServiceError,
  verifyAndStageUploadedPackage,
} from "@/server/updates/update-service";
import { startUpdateTask } from "@/server/updates/update-task";
import { safeActionErrorMessage } from "@/server/shared/action-error";

// This module deliberately imports requirePermission from server-guards.ts
// (unrestricted), not licensed-guards.ts. A legitimate signed update must
// remain installable in every license state, including fully restricted
// ones -- otherwise a licensing problem could never be fixed by the very
// update that resolves it (Phase 34 design, Section 11). "updates.manage"
// is the only gate here.

export type UpdateActionState = {
  ok: boolean;
  message: string;
  packageId?: string;
  toVersion?: string;
};

export async function uploadUpdatePackageAction(
  _state: UpdateActionState | undefined,
  formData: FormData,
): Promise<UpdateActionState> {
  const actor = await requirePermission("updates.manage");
  const file = formData.get("packageFile");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, message: "Choose a .hfupdate file to upload." };
  }
  if (file.size > 512 * 1024 * 1024) {
    return { ok: false, message: "Update package is unexpectedly large; upload refused." };
  }
  const content = Buffer.from(await file.arrayBuffer());
  const result = verifyAndStageUploadedPackage(content);
  if (!result.ok) return { ok: false, message: result.reason };

  await recordAuditEvent(prisma, {
    actorUserId: actor.id,
    action: "CREATE",
    entityType: "SOFTWARE_UPDATE",
    entityId: result.packageId,
    module: "administration",
    description: `Verified and staged an update package (${result.fromVersion} -> ${result.toVersion}).`,
    metadata: {
      fromVersion: result.fromVersion,
      toVersion: result.toVersion,
      previousVersionCompatibleWithNewSchema: result.previousVersionCompatibleWithNewSchema,
    },
    controlEvent: true,
  });
  revalidatePath("/administration/updates");
  return {
    ok: true,
    message: `Package verified: ${result.fromVersion} -> ${result.toVersion}. ${result.releaseNotesSummary}`,
    packageId: result.packageId,
    toVersion: result.toVersion,
  };
}

export async function installUpdateNowAction(
  _state: UpdateActionState | undefined,
  formData: FormData,
): Promise<UpdateActionState> {
  const actor = await requirePermission("updates.manage");
  const packageId = String(formData.get("packageId") ?? "").trim();
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(packageId)) {
    return { ok: false, message: "No verified package is selected." };
  }
  try {
    const { updateId } = armUpdate(packageId);
    const started = startUpdateTask(
      process.env.HAMDFOODS_UPDATE_TASK_NAME ?? "HamdFoodsERP-Update",
    );
    await recordAuditEvent(prisma, {
      actorUserId: actor.id,
      action: "UPDATE",
      entityType: "SOFTWARE_UPDATE",
      entityId: packageId,
      module: "administration",
      description: "Armed and started an update installation.",
      metadata: { updateId, taskStarted: started.ok },
      controlEvent: true,
    });
    revalidatePath("/administration/updates");
    if (!started.ok)
      return { ok: false, message: `Update armed but could not be started: ${started.message}` };
    return { ok: true, message: "Update installation started. Do not power off this machine." };
  } catch (error) {
    return {
      ok: false,
      message: safeActionErrorMessage(error, "Could not start the update.", UpdateServiceError),
    };
  }
}
