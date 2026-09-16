import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import type { UpdateStateData } from "@/modules/updates/domain/update-state";

import {
  derivePackageId,
  resolveUpdatePackagePaths,
  resolveUpdatePackagePath,
  type UpdatePackagePaths,
} from "./update-package-store";
import { resolveUpdateStateStorePaths, readUpdateState } from "./update-state-store";
import { resolveDpapiScriptPath } from "@/server/licensing/dpapi";
import {
  resolveOrchestratorRuntime,
  resolveVerifyPackageScriptPath,
  verifyUpdatePackageFile,
} from "./verify-update-package-file";

export class UpdateServiceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UpdateServiceError";
  }
}

function dataRootEnv(): string | undefined {
  return process.env.HAMDFOODS_DATA_ROOT;
}

export function resolveUpdateDataRoot(): string {
  return dataRootEnv() ?? path.join(process.cwd(), ".license-runtime");
}

export function getCurrentAppVersion(): string {
  const packageJsonPath = path.join(process.cwd(), "package.json");
  const parsed: unknown = JSON.parse(readFileSync(packageJsonPath, "utf8"));
  const version = (parsed as { version?: unknown }).version;
  if (typeof version !== "string" || !/^\d+\.\d+\.\d+$/.test(version)) {
    throw new UpdateServiceError("The running application's version could not be determined.");
  }
  return version;
}

export type PackageVerificationOutcome =
  | {
      ok: true;
      packageId: string;
      toVersion: string;
      fromVersion: string;
      previousVersionCompatibleWithNewSchema: boolean;
      releaseNotesSummary: string;
    }
  | { ok: false; reason: string };

/**
 * Safe, read-only-with-respect-to-any-release step: verifies an uploaded
 * .hfupdate package's signature/manifest and, only if valid, stores the raw
 * bytes under a content-derived id for the SYSTEM update task to later
 * independently re-verify and extract. Never touches any release
 * directory, the database, or the Scheduled Task -- safe to run inside the
 * currently-active release's own process (Phase 34 design, Section 10).
 */
export function verifyAndStageUploadedPackage(content: Buffer): PackageVerificationOutcome {
  const dataRoot = resolveUpdateDataRoot();
  const paths = resolveUpdatePackagePaths(dataRoot);
  mkdirSync(paths.updatesDirectory, { recursive: true });

  const temporaryPath = path.join(paths.updatesDirectory, `upload-${randomUUID()}.hfupdate`);
  writeFileSync(temporaryPath, content);

  try {
    const scriptPath = resolveVerifyPackageScriptPath({
      repositoryRoot: process.cwd(),
      dataRoot: dataRootEnv(),
    });
    const orchestrator = resolveOrchestratorRuntime({
      repositoryRoot: process.cwd(),
      dataRoot: dataRootEnv(),
    });
    const result = verifyUpdatePackageFile(temporaryPath, scriptPath, orchestrator);
    if (!result.valid) return { ok: false, reason: result.reason };

    const currentVersion = getCurrentAppVersion();
    if (result.manifest.fromVersion !== currentVersion) {
      return {
        ok: false,
        reason: `This package upgrades from ${result.manifest.fromVersion}, but the installed version is ${currentVersion}.`,
      };
    }

    const packageId = derivePackageId(
      JSON.stringify(result.manifest),
      readFileSync(temporaryPath).toString("base64"),
    );
    const finalPath = resolveUpdatePackagePath(paths, packageId);
    if (!existsSync(finalPath)) renameSync(temporaryPath, finalPath);

    return {
      ok: true,
      packageId,
      toVersion: result.manifest.toVersion,
      fromVersion: result.manifest.fromVersion,
      previousVersionCompatibleWithNewSchema:
        result.manifest.previousVersionCompatibleWithNewSchema,
      releaseNotesSummary: result.manifest.releaseNotesSummary,
    };
  } finally {
    if (existsSync(temporaryPath)) {
      try {
        rmSync(temporaryPath, { force: true });
      } catch {
        // best-effort cleanup only
      }
    }
  }
}

/**
 * Arms the SYSTEM HamdFoodsERP-Update task with a controlled packageId --
 * never an arbitrary filesystem path -- and starts it. The task itself
 * independently re-verifies the package before doing anything irreversible.
 */
export function armUpdate(packageId: string): { updateId: string } {
  const dataRoot = resolveUpdateDataRoot();
  const packagePaths = resolveUpdatePackagePaths(dataRoot);
  const packagePath = resolveUpdatePackagePath(packagePaths, packageId);
  if (!existsSync(packagePath))
    throw new UpdateServiceError("The requested update package is not staged.");

  const updateId = randomUUID();
  const temporary = `${packagePaths.pendingUpdateFile}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(
    temporary,
    JSON.stringify({ updateId, packageId, armedAt: new Date().toISOString() }),
  );
  renameSync(temporary, packagePaths.pendingUpdateFile);

  return { updateId };
}

export type UpdateStatus = { kind: "none" } | { kind: "known"; data: UpdateStateData };

export function getCurrentUpdateStatus(): UpdateStatus {
  const dataRoot = resolveUpdateDataRoot();
  const statePaths = resolveUpdateStateStorePaths(dataRoot);
  const scriptPath = resolveDpapiScriptPath({
    repositoryRoot: process.cwd(),
    dataRoot: dataRootEnv(),
  });
  const result = readUpdateState(statePaths, scriptPath);
  if (result.kind !== "ok") return { kind: "none" };
  return { kind: "known", data: result.data };
}

export function resolveUpdatePackageStagingPaths(): UpdatePackagePaths {
  return resolveUpdatePackagePaths(resolveUpdateDataRoot());
}
