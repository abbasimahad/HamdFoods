import { randomBytes, createHmac, timingSafeEqual } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

import {
  canonicalizeLicenseStateData,
  type LicenseStateData,
} from "@/modules/licensing/domain/license";

import { dpapiProtect, dpapiUnprotect } from "./dpapi";

export type LicenseStateReadResult =
  { kind: "absent" } | { kind: "ok"; data: LicenseStateData } | { kind: "corrupted" };

export type LicenseStateStorePaths = {
  configDirectory: string;
  stateFile: string;
  keyFile: string;
};

export function resolveLicenseStateStorePaths(dataRoot: string): LicenseStateStorePaths {
  const configDirectory = path.join(dataRoot, "config");
  return {
    configDirectory,
    stateFile: path.join(configDirectory, "license-state.json"),
    keyFile: path.join(configDirectory, "license-state.key"),
  };
}

type StoredStateFile = { schemaVersion: 1; state: LicenseStateData; hmac: string };

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
 * watermark authenticated with an HMAC keyed by a key sealed via Windows
 * DPAPI (LocalMachine scope, see dpapi.ts). No HMAC secret is embedded in
 * this module or the repository: the key is generated locally on first use,
 * DPAPI-protected at rest, and never leaves the machine. Copying either file
 * to another machine, deleting one but not the other, or editing the state
 * JSON all fail the integrity check and resolve to "corrupted" (mapped by
 * the domain layer to TAMPERED_STATE) rather than silently trusting altered
 * data. Both files live under DataRoot\config, which the installer already
 * ACLs to SYSTEM + Administrators with inheritance -- no separate ACL call
 * is needed here.
 */
export function readLicenseState(
  paths: LicenseStateStorePaths,
  scriptPath: string,
): LicenseStateReadResult {
  const stateExists = existsSync(paths.stateFile);
  const keyExists = existsSync(paths.keyFile);
  if (!stateExists && !keyExists) return { kind: "absent" };
  if (stateExists !== keyExists) return { kind: "corrupted" };

  try {
    const keyProtectedBase64 = readFileSync(paths.keyFile, "utf8").trim();
    const keyBase64 = dpapiUnprotect(keyProtectedBase64, scriptPath);
    const key = Buffer.from(keyBase64, "base64");

    const raw: unknown = JSON.parse(readFileSync(paths.stateFile, "utf8"));
    if (!isPlainObject(raw) || raw.schemaVersion !== 1 || typeof raw.hmac !== "string") {
      return { kind: "corrupted" };
    }
    if (!isValidStateData(raw.state)) return { kind: "corrupted" };

    const expectedHmac = createHmac("sha256", key)
      .update(canonicalizeLicenseStateData(raw.state), "utf8")
      .digest();
    const actualHmac = Buffer.from(raw.hmac, "base64");
    if (expectedHmac.length !== actualHmac.length || !timingSafeEqual(expectedHmac, actualHmac)) {
      return { kind: "corrupted" };
    }

    return { kind: "ok", data: raw.state };
  } catch {
    return { kind: "corrupted" };
  }
}

export function writeLicenseState(
  paths: LicenseStateStorePaths,
  scriptPath: string,
  data: LicenseStateData,
): void {
  mkdirSync(paths.configDirectory, { recursive: true });

  let key: Buffer;
  if (existsSync(paths.keyFile)) {
    const keyProtectedBase64 = readFileSync(paths.keyFile, "utf8").trim();
    key = Buffer.from(dpapiUnprotect(keyProtectedBase64, scriptPath), "base64");
  } else {
    key = randomBytes(32);
    const protectedKey = dpapiProtect(key.toString("base64"), scriptPath);
    atomicWrite(paths.keyFile, protectedKey);
  }

  const hmac = createHmac("sha256", key)
    .update(canonicalizeLicenseStateData(data), "utf8")
    .digest();
  const stored: StoredStateFile = { schemaVersion: 1, state: data, hmac: hmac.toString("base64") };
  atomicWrite(paths.stateFile, JSON.stringify(stored, null, 2));
}

/** Clears both protected files so a corrupted local cache can be regenerated from scratch. */
export function resetLicenseState(paths: LicenseStateStorePaths): void {
  for (const file of [paths.stateFile, paths.keyFile]) {
    if (existsSync(file)) unlinkSync(file);
  }
}

function atomicWrite(destination: string, content: string): void {
  const temporary = `${destination}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(temporary, content, "utf8");
  renameSync(temporary, destination);
}
