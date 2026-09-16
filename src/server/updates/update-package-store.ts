import { createHash } from "node:crypto";
import { existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

export type UpdatePackagePaths = {
  updatesDirectory: string;
  pendingUpdateFile: string;
};

export function resolveUpdatePackagePaths(dataRoot: string): UpdatePackagePaths {
  const stateDirectory = path.join(dataRoot, "state");
  return {
    updatesDirectory: path.join(stateDirectory, "updates"),
    pendingUpdateFile: path.join(stateDirectory, "pending-update.json"),
  };
}

/** Content-derived id: stable for the same manifest+signature bytes, never client-supplied. */
export function derivePackageId(manifestJson: string, signatureBase64: string): string {
  return createHash("sha256")
    .update(manifestJson)
    .update(signatureBase64)
    .digest("hex")
    .slice(0, 32);
}

export function storeUpdatePackage(
  paths: UpdatePackagePaths,
  packageId: string,
  content: Buffer,
): string {
  mkdirSync(paths.updatesDirectory, { recursive: true });
  const destination = path.join(paths.updatesDirectory, `${packageId}.hfupdate`);
  const temporary = `${destination}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(temporary, content);
  renameSync(temporary, destination);
  return destination;
}

export function resolveUpdatePackagePath(paths: UpdatePackagePaths, packageId: string): string {
  return path.join(paths.updatesDirectory, `${packageId}.hfupdate`);
}

export function removeUpdatePackage(paths: UpdatePackagePaths, packageId: string): void {
  const target = resolveUpdatePackagePath(paths, packageId);
  if (existsSync(target)) rmSync(target, { force: true });
}
