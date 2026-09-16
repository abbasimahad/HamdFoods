import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

import {
  canonicalizeLicensePayload,
  parseLicensePayload,
  type LicenseFileVerdict,
} from "@/modules/licensing/domain/license";

import { verifyEd25519 } from "./ed25519";
import { TRUSTED_LICENSE_PUBLIC_KEYS } from "./public-keys";

export class LicenseFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LicenseFileError";
  }
}

export type LicenseFilePaths = {
  configDirectory: string;
  licenseFile: string;
  activationRequestFile: string;
};

export function resolveLicenseFilePaths(dataRoot: string): LicenseFilePaths {
  const configDirectory = path.join(dataRoot, "config");
  return {
    configDirectory,
    licenseFile: path.join(configDirectory, "license.lic"),
    activationRequestFile: path.join(configDirectory, "activation-request.json"),
  };
}

/**
 * Parses and Ed25519-verifies a license file's raw JSON text in memory,
 * touching no filesystem. Shared by readLicenseFileVerdict (the already-
 * on-disk file) and importLicenseFile (Phase 35 L2: an admin-uploaded file
 * must be verified before it is ever written to disk, not after).
 */
function verifyLicenseFileContent(
  content: string,
  trustedKeys: Readonly<Record<string, string>>,
): LicenseFileVerdict {
  try {
    const raw: unknown = JSON.parse(content);
    if (
      typeof raw !== "object" ||
      raw === null ||
      typeof (raw as Record<string, unknown>).signature !== "string"
    ) {
      return { kind: "invalid-signature" };
    }
    const payload = parseLicensePayload((raw as { payload: unknown }).payload);
    const publicKeyPem = trustedKeys[payload.keyId];
    if (!publicKeyPem) return { kind: "invalid-signature" };

    const valid = verifyEd25519({
      message: canonicalizeLicensePayload(payload),
      signatureBase64: (raw as { signature: string }).signature,
      publicKeyPem,
    });
    return valid ? { kind: "valid", payload } : { kind: "invalid-signature" };
  } catch {
    return { kind: "invalid-signature" };
  }
}

export function readLicenseFileVerdict(
  paths: LicenseFilePaths,
  trustedKeys: Readonly<Record<string, string>> = TRUSTED_LICENSE_PUBLIC_KEYS,
): LicenseFileVerdict {
  if (!existsSync(paths.licenseFile)) return { kind: "absent" };
  return verifyLicenseFileContent(readFileSync(paths.licenseFile, "utf8"), trustedKeys);
}

/**
 * Verifies an admin-uploaded .lic file's signature before it is ever
 * written to disk -- an unsigned, tampered, or wrong-key upload never
 * touches config/license.lic, matching the same verify-before-trust
 * ordering already used for Phase 34 update packages.
 */
export function importLicenseFile(
  paths: LicenseFilePaths,
  content: string,
  trustedKeys: Readonly<Record<string, string>> = TRUSTED_LICENSE_PUBLIC_KEYS,
): void {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new LicenseFileError("The uploaded file is not valid license JSON.");
  }
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    typeof (parsed as Record<string, unknown>).signature !== "string" ||
    typeof (parsed as Record<string, unknown>).payload !== "object"
  ) {
    throw new LicenseFileError("The uploaded file is not a recognized license format.");
  }

  const verdict = verifyLicenseFileContent(content, trustedKeys);
  if (verdict.kind !== "valid") {
    throw new LicenseFileError(
      "The uploaded license file's signature could not be verified. It was not saved.",
    );
  }

  mkdirSync(paths.configDirectory, { recursive: true });
  const temporary = `${paths.licenseFile}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(temporary, content, "utf8");
  renameSync(temporary, paths.licenseFile);
}
