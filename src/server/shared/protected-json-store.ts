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

import { dpapiProtect, dpapiUnprotect } from "@/server/licensing/dpapi";

export type ProtectedJsonReadResult<T> =
  { kind: "absent" } | { kind: "ok"; data: T } | { kind: "corrupted" };

export type ProtectedJsonPaths = {
  configDirectory: string;
  dataFile: string;
  keyFile: string;
};

/**
 * Resolves the paths for one DPAPI/HMAC-protected small JSON state file.
 * dataFileName/keyFileName give each caller (license state, update state, ...)
 * its own independent files, and therefore its own independent DPAPI-sealed
 * HMAC key -- callers never share key material even though they share this
 * code.
 */
export function resolveProtectedJsonPaths(
  dataRoot: string,
  dataFileName: string,
  keyFileName: string,
): ProtectedJsonPaths {
  const configDirectory = path.join(dataRoot, "config");
  return {
    configDirectory,
    dataFile: path.join(configDirectory, dataFileName),
    keyFile: path.join(configDirectory, keyFileName),
  };
}

// The on-disk envelope key is "state" (not "data") for backward
// compatibility with already-deployed license-state.json files written
// before this module existed -- only the in-memory API uses "data".
type StoredJsonFile = { schemaVersion: 1; state: unknown; hmac: string };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * DPAPI/HMAC-protected small JSON state file, generalized from Phase 33's
 * license-state.json so a second, fully independent caller (Phase 34's
 * update-state.json) can reuse the exact same protection code without
 * sharing key material. The HMAC key is generated locally on first write,
 * sealed via Windows DPAPI (LocalMachine scope, see dpapi.ts), and never
 * embedded or transmitted. Deleting one file but not the other, copying
 * either to a different machine, or hand-editing the data all fail the
 * integrity check and resolve to "corrupted" rather than silently trusting
 * altered data. Both files live under DataRoot\config, which the installer
 * already ACLs to SYSTEM + Administrators with inheritance.
 */
export function readProtectedJson<T>(
  paths: ProtectedJsonPaths,
  scriptPath: string,
  isValid: (value: unknown) => value is T,
  canonicalize: (data: T) => string,
): ProtectedJsonReadResult<T> {
  const dataExists = existsSync(paths.dataFile);
  const keyExists = existsSync(paths.keyFile);
  if (!dataExists && !keyExists) return { kind: "absent" };
  if (dataExists !== keyExists) return { kind: "corrupted" };

  try {
    const keyProtectedBase64 = readFileSync(paths.keyFile, "utf8").trim();
    const keyBase64 = dpapiUnprotect(keyProtectedBase64, scriptPath);
    const key = Buffer.from(keyBase64, "base64");

    const raw: unknown = JSON.parse(readFileSync(paths.dataFile, "utf8"));
    if (!isPlainObject(raw) || raw.schemaVersion !== 1 || typeof raw.hmac !== "string") {
      return { kind: "corrupted" };
    }
    if (!isValid(raw.state)) return { kind: "corrupted" };

    const expectedHmac = createHmac("sha256", key).update(canonicalize(raw.state), "utf8").digest();
    const actualHmac = Buffer.from(raw.hmac, "base64");
    if (expectedHmac.length !== actualHmac.length || !timingSafeEqual(expectedHmac, actualHmac)) {
      return { kind: "corrupted" };
    }

    return { kind: "ok", data: raw.state };
  } catch {
    return { kind: "corrupted" };
  }
}

export function writeProtectedJson<T>(
  paths: ProtectedJsonPaths,
  scriptPath: string,
  canonicalize: (data: T) => string,
  data: T,
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

  const hmac = createHmac("sha256", key).update(canonicalize(data), "utf8").digest();
  const stored: StoredJsonFile = { schemaVersion: 1, state: data, hmac: hmac.toString("base64") };
  atomicWrite(paths.dataFile, JSON.stringify(stored, null, 2));
}

/** Clears both protected files so a corrupted local cache can be regenerated from scratch. */
export function resetProtectedJson(paths: ProtectedJsonPaths): void {
  for (const file of [paths.dataFile, paths.keyFile]) {
    if (existsSync(file)) unlinkSync(file);
  }
}

export function atomicWrite(destination: string, content: string): void {
  const temporary = `${destination}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(temporary, content, "utf8");
  renameSync(temporary, destination);
}
