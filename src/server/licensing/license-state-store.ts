import {
  canonicalizeLicenseStateData,
  type LicenseStateData,
} from "@/modules/licensing/domain/license";
import {
  readProtectedJson,
  resetProtectedJson,
  resolveProtectedJsonPaths,
  writeProtectedJson,
  type ProtectedJsonPaths,
  type ProtectedJsonReadResult,
} from "@/server/shared/protected-json-store";

export type LicenseStateReadResult = ProtectedJsonReadResult<LicenseStateData>;
export type LicenseStateStorePaths = ProtectedJsonPaths;

const DATA_FILE_NAME = "license-state.json";
const KEY_FILE_NAME = "license-state.key";

export function resolveLicenseStateStorePaths(dataRoot: string): LicenseStateStorePaths {
  return resolveProtectedJsonPaths(dataRoot, DATA_FILE_NAME, KEY_FILE_NAME);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isValidStateData(value: unknown): value is LicenseStateData {
  if (!isPlainObject(value)) return false;
  return (
    value.schemaVersion === 1 &&
    typeof value.setupGraceAnchor === "string" &&
    !Number.isNaN(Date.parse(value.setupGraceAnchor)) &&
    (value.expiryGraceAnchor === null ||
      (typeof value.expiryGraceAnchor === "string" &&
        !Number.isNaN(Date.parse(value.expiryGraceAnchor)))) &&
    typeof value.lastObservedTime === "string" &&
    !Number.isNaN(Date.parse(value.lastObservedTime))
  );
}

/**
 * license-state.json holds the grace-period anchors and clock-rollback
 * watermark, protected by src/server/shared/protected-json-store.ts (DPAPI
 * LocalMachine-sealed HMAC key, generated locally, never embedded). See
 * that module's doc comment for the full integrity/tamper-detection
 * rationale. This file only supplies license-state.json's own file names
 * and its own canonicalization (unchanged from before this module existed,
 * so already-deployed license-state.json files keep verifying correctly).
 * update-state.json (Phase 34) uses the same code with an independent key
 * file -- see src/server/updates/update-state-store.ts.
 */
export function readLicenseState(
  paths: LicenseStateStorePaths,
  scriptPath: string,
): LicenseStateReadResult {
  return readProtectedJson(paths, scriptPath, isValidStateData, canonicalizeLicenseStateData);
}

export function writeLicenseState(
  paths: LicenseStateStorePaths,
  scriptPath: string,
  data: LicenseStateData,
): void {
  writeProtectedJson(paths, scriptPath, canonicalizeLicenseStateData, data);
}

/** Clears both protected files so a corrupted local cache can be regenerated from scratch. */
export function resetLicenseState(paths: LicenseStateStorePaths): void {
  resetProtectedJson(paths);
}
