import {
  canonicalizeUpdateManifest,
  parseUpdateManifest,
  UpdateManifestError,
  type UpdateManifest,
} from "@/modules/updates/domain/update-manifest";
import { verifyEd25519 } from "@/server/licensing/ed25519";

import { TRUSTED_UPDATE_PUBLIC_KEYS } from "./update-public-keys";

export type VerifyManifestResult =
  { valid: true; manifest: UpdateManifest } | { valid: false; reason: string };

/**
 * Verifies an update package's manifest signature before any payload entry
 * is trusted (Phase 34 design, Section 2, step 2). Pure with respect to the
 * filesystem/zip -- callers (the bootstrap CLI wrapper, the admin-UI
 * upload-verification action) are responsible for extracting exactly
 * manifest.json/manifest.sig out of the archive and passing their raw
 * bytes here, before anything else in the archive is touched.
 */
export function verifyUpdateManifest(input: {
  manifestJson: string;
  signatureBase64: string;
  trustedKeys?: Readonly<Record<string, string>>;
}): VerifyManifestResult {
  const trustedKeys = input.trustedKeys ?? TRUSTED_UPDATE_PUBLIC_KEYS;

  let rawManifest: unknown;
  try {
    rawManifest = JSON.parse(input.manifestJson);
  } catch {
    return { valid: false, reason: "manifest.json is not valid JSON." };
  }

  let manifest: UpdateManifest;
  try {
    manifest = parseUpdateManifest(rawManifest);
  } catch (error) {
    const reason =
      error instanceof UpdateManifestError ? error.message : "manifest.json is invalid.";
    return { valid: false, reason };
  }

  const publicKeyPem = trustedKeys[manifest.keyId];
  if (!publicKeyPem)
    return { valid: false, reason: `Unknown or untrusted keyId: ${manifest.keyId}.` };

  const signatureValid = verifyEd25519({
    message: canonicalizeUpdateManifest(manifest),
    signatureBase64: input.signatureBase64,
    publicKeyPem,
  });
  if (!signatureValid) return { valid: false, reason: "Manifest signature verification failed." };

  return { valid: true, manifest };
}

export function verifyExtractedFile(input: {
  declared: { path: string; sha256: string; size: number };
  actualSha256: string;
  actualSize: number;
}): boolean {
  return (
    input.declared.sha256.toLowerCase() === input.actualSha256.toLowerCase() &&
    input.declared.size === input.actualSize
  );
}
