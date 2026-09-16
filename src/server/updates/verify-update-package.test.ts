import { generateKeyPairSync } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  canonicalizeUpdateManifest,
  type UpdateManifest,
} from "@/modules/updates/domain/update-manifest";
import { signEd25519 } from "@/server/licensing/ed25519";

import { verifyExtractedFile, verifyUpdateManifest } from "./verify-update-package";

function keypair() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  return {
    publicKeyPem: publicKey.export({ type: "spki", format: "pem" }).toString(),
    privateKeyPem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
  };
}

function manifest(overrides: Partial<UpdateManifest> = {}): UpdateManifest {
  return {
    manifestVersion: 1,
    keyId: "test-update-key",
    fromVersion: "0.1.0",
    toVersion: "0.2.0",
    minimumInstallerSchemaVersion: 1,
    nodeRuntimeIncluded: false,
    requiredNodeVersion: "24.11.1",
    previousVersionCompatibleWithNewSchema: true,
    issuedAt: "2026-01-01T00:00:00.000Z",
    releaseNotesSummary: "Test release",
    files: [{ path: "payload/app/server.js", sha256: "a".repeat(64), size: 10 }],
    ...overrides,
  };
}

function sign(privateKeyPem: string, manifestValue: UpdateManifest) {
  return signEd25519({ message: canonicalizeUpdateManifest(manifestValue), privateKeyPem });
}

describe("verifyUpdateManifest", () => {
  it("verifies a correctly signed manifest under a trusted key", () => {
    const { publicKeyPem, privateKeyPem } = keypair();
    const value = manifest({ keyId: "vendor-1" });
    const signatureBase64 = sign(privateKeyPem, value);
    const result = verifyUpdateManifest({
      manifestJson: JSON.stringify(value),
      signatureBase64,
      trustedKeys: { "vendor-1": publicKeyPem },
    });
    expect(result).toEqual({ valid: true, manifest: value });
  });

  it("rejects a signature from an untrusted keyId", () => {
    const { privateKeyPem } = keypair();
    const value = manifest({ keyId: "unknown-vendor" });
    const signatureBase64 = sign(privateKeyPem, value);
    const result = verifyUpdateManifest({
      manifestJson: JSON.stringify(value),
      signatureBase64,
      trustedKeys: { "vendor-1": keypair().publicKeyPem },
    });
    expect(result.valid).toBe(false);
  });

  it("rejects a tampered manifest (signature no longer matches)", () => {
    const { publicKeyPem, privateKeyPem } = keypair();
    const value = manifest({ keyId: "vendor-1" });
    const signatureBase64 = sign(privateKeyPem, value);
    const tampered = { ...value, toVersion: "9.9.9" };
    const result = verifyUpdateManifest({
      manifestJson: JSON.stringify(tampered),
      signatureBase64,
      trustedKeys: { "vendor-1": publicKeyPem },
    });
    expect(result.valid).toBe(false);
  });

  it("rejects malformed manifest JSON", () => {
    const result = verifyUpdateManifest({
      manifestJson: "{ not json",
      signatureBase64: "AAAA",
      trustedKeys: {},
    });
    expect(result).toEqual({ valid: false, reason: "manifest.json is not valid JSON." });
  });

  it("rejects a manifest with an unsafe file path even if correctly signed", () => {
    const { publicKeyPem, privateKeyPem } = keypair();
    // parseUpdateManifest throws before signature verification is reached,
    // so an unsafe path is rejected regardless of a valid signature --
    // trust in the signer does not extend to trusting an unsafe payload
    // shape.
    const rawUnsafe = {
      ...manifest({ keyId: "vendor-1" }),
      files: [{ path: "../evil.js", sha256: "a".repeat(64), size: 1 }],
    };
    const signatureBase64 = signEd25519({
      message: JSON.stringify(rawUnsafe),
      privateKeyPem,
    });
    const result = verifyUpdateManifest({
      manifestJson: JSON.stringify(rawUnsafe),
      signatureBase64,
      trustedKeys: { "vendor-1": publicKeyPem },
    });
    expect(result.valid).toBe(false);
  });

  it("supports multiple trusted keys for rotation", () => {
    const oldKey = keypair();
    const newKey = keypair();
    const oldSigned = manifest({ keyId: "old-vendor", toVersion: "0.2.0" });
    const newSigned = manifest({ keyId: "new-vendor", toVersion: "0.3.0" });
    const trustedKeys = { "old-vendor": oldKey.publicKeyPem, "new-vendor": newKey.publicKeyPem };

    const oldResult = verifyUpdateManifest({
      manifestJson: JSON.stringify(oldSigned),
      signatureBase64: sign(oldKey.privateKeyPem, oldSigned),
      trustedKeys,
    });
    const newResult = verifyUpdateManifest({
      manifestJson: JSON.stringify(newSigned),
      signatureBase64: sign(newKey.privateKeyPem, newSigned),
      trustedKeys,
    });
    expect(oldResult.valid).toBe(true);
    expect(newResult.valid).toBe(true);
  });
});

describe("verifyExtractedFile", () => {
  it("passes for a matching hash and size", () => {
    expect(
      verifyExtractedFile({
        declared: { path: "payload/app/server.js", sha256: "AB".repeat(32), size: 10 },
        actualSha256: "ab".repeat(32),
        actualSize: 10,
      }),
    ).toBe(true);
  });

  it("fails for a hash mismatch", () => {
    expect(
      verifyExtractedFile({
        declared: { path: "payload/app/server.js", sha256: "a".repeat(64), size: 10 },
        actualSha256: "b".repeat(64),
        actualSize: 10,
      }),
    ).toBe(false);
  });

  it("fails for a size mismatch", () => {
    expect(
      verifyExtractedFile({
        declared: { path: "payload/app/server.js", sha256: "a".repeat(64), size: 10 },
        actualSha256: "a".repeat(64),
        actualSize: 11,
      }),
    ).toBe(false);
  });
});
