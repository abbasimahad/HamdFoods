import {
  canonicalizeUpdateStateData,
  isUpdateStage,
  type UpdateStateData,
} from "@/modules/updates/domain/update-state";
import {
  readProtectedJson,
  resetProtectedJson,
  resolveProtectedJsonPaths,
  writeProtectedJson,
  type ProtectedJsonPaths,
  type ProtectedJsonReadResult,
} from "@/server/shared/protected-json-store";

export type UpdateStateReadResult = ProtectedJsonReadResult<UpdateStateData>;
export type UpdateStateStorePaths = ProtectedJsonPaths;

// Deliberately different file names from license-state.json/license-state.key
// so this state uses an entirely independent DPAPI-sealed HMAC key -- see
// the Phase 34 design's "additional state rule" and
// src/server/shared/protected-json-store.ts's doc comment.
const DATA_FILE_NAME = "update-state.json";
const KEY_FILE_NAME = "update-state.key";

export function resolveUpdateStateStorePaths(dataRoot: string): UpdateStateStorePaths {
  return resolveProtectedJsonPaths(dataRoot, DATA_FILE_NAME, KEY_FILE_NAME);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isIsoStringOrNull(value: unknown): value is string | null {
  return value === null || (typeof value === "string" && !Number.isNaN(Date.parse(value)));
}

function isValidUpdateStateData(value: unknown): value is UpdateStateData {
  if (!isPlainObject(value)) return false;
  return (
    value.schemaVersion === 1 &&
    typeof value.updateId === "string" &&
    typeof value.packageId === "string" &&
    typeof value.fromVersion === "string" &&
    typeof value.toVersion === "string" &&
    isUpdateStage(value.stage) &&
    (value.backupId === null || typeof value.backupId === "string") &&
    typeof value.previousRelease === "string" &&
    typeof value.targetRelease === "string" &&
    typeof value.migrationCompleted === "boolean" &&
    isIsoStringOrNull(value.migrationCompletedAt) &&
    typeof value.activationCompleted === "boolean" &&
    isIsoStringOrNull(value.activationCompletedAt) &&
    (value.healthResult === "pending" ||
      value.healthResult === "pass" ||
      value.healthResult === "fail") &&
    isIsoStringOrNull(value.healthCheckedAt) &&
    (value.rollbackResult === "not-attempted" ||
      value.rollbackResult === "succeeded" ||
      value.rollbackResult === "failed" ||
      value.rollbackResult === "prohibited") &&
    isIsoStringOrNull(value.rollbackAt) &&
    typeof value.createdAt === "string" &&
    typeof value.updatedAt === "string"
  );
}

/**
 * update-state.json: the durable record of an update attempt's progress,
 * used to make recovery after an interruption or power loss idempotent
 * (Phase 34 design, Sections 8-9). Protected by the same DPAPI/HMAC code as
 * license-state.json (src/server/shared/protected-json-store.ts) but with
 * its own key file, so the two states can never be cross-authenticated or
 * cross-tampered.
 */
export function readUpdateState(
  paths: UpdateStateStorePaths,
  scriptPath: string,
): UpdateStateReadResult {
  return readProtectedJson(paths, scriptPath, isValidUpdateStateData, canonicalizeUpdateStateData);
}

export function writeUpdateState(
  paths: UpdateStateStorePaths,
  scriptPath: string,
  data: UpdateStateData,
): void {
  writeProtectedJson(paths, scriptPath, canonicalizeUpdateStateData, data);
}

export function resetUpdateState(paths: UpdateStateStorePaths): void {
  resetProtectedJson(paths);
}
