import { mkdirSync, renameSync, writeFileSync } from "node:fs";

import type { LicenseFilePaths } from "./license-file-store";

export type ActivationRequest = {
  requestVersion: 1;
  machineFingerprint: string;
  generatedAt: string;
};

export function buildActivationRequest(machineFingerprint: string, now: Date): ActivationRequest {
  return { requestVersion: 1, machineFingerprint, generatedAt: now.toISOString() };
}

/**
 * Writes the unsigned activation request the operator sends to the vendor
 * out-of-band (email/USB). This file contains no secret -- the machine
 * fingerprint is non-secret by design (see machine-fingerprint.ts).
 */
export function writeActivationRequestFile(
  paths: LicenseFilePaths,
  request: ActivationRequest,
): string {
  mkdirSync(paths.configDirectory, { recursive: true });
  const content = JSON.stringify(request, null, 2);
  const temporary = `${paths.activationRequestFile}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(temporary, content, "utf8");
  renameSync(temporary, paths.activationRequestFile);
  return paths.activationRequestFile;
}
