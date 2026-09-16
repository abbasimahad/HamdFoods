import { generateKeyPairSync } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  canonicalizeLicensePayload,
  type LicensePayload,
} from "@/modules/licensing/domain/license";

import { signEd25519 } from "./ed25519";
import { importLicenseFile, resolveLicenseFilePaths } from "./license-file-store";
import { computeLicenseStatus, getLicenseStatus } from "./license-service";
import { computeMachineFingerprint, resolveFingerprintScriptPath } from "./machine-fingerprint";

const windowsIt = process.platform === "win32" ? it : it.skip;

let tempDirectories: string[] = [];
function tempDataRoot() {
  const dir = mkdtempSync(path.join(os.tmpdir(), "hamdfoods-license-service-"));
  tempDirectories.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of tempDirectories) rmSync(dir, { recursive: true, force: true });
  tempDirectories = [];
});

function testKeypair() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  return {
    publicKeyPem: publicKey.export({ type: "spki", format: "pem" }).toString(),
    privateKeyPem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
  };
}

function importSigned(
  dataRoot: string,
  privateKeyPem: string,
  payload: LicensePayload,
  trustedKeys: Readonly<Record<string, string>>,
) {
  const signature = signEd25519({ message: canonicalizeLicensePayload(payload), privateKeyPem });
  importLicenseFile(
    resolveLicenseFilePaths(dataRoot),
    JSON.stringify({ payload, signature }),
    trustedKeys,
  );
}

/**
 * Places a signed license file directly on disk, bypassing importLicenseFile's
 * verify-before-write check (Phase 35 L2) -- for scenarios that must exist as
 * an already-on-disk fact regardless of whether today's import would accept
 * it (an untrusted/since-rotated-out key, a hand-corrupted file), not for
 * simulating a normal admin upload.
 */
function writeSignedDirectly(dataRoot: string, privateKeyPem: string, payload: LicensePayload) {
  const signature = signEd25519({ message: canonicalizeLicensePayload(payload), privateKeyPem });
  const paths = resolveLicenseFilePaths(dataRoot);
  mkdirSync(paths.configDirectory, { recursive: true });
  writeFileSync(paths.licenseFile, JSON.stringify({ payload, signature }));
}

describe("getLicenseStatus outside production", () => {
  it("is always unrestricted VALID when APP_ENV is not production", () => {
    const status = getLicenseStatus({ forceRefresh: true });
    expect(status.state).toBe("VALID");
    expect(status.mutationAllowed).toBe(true);
  });
});

describe("computeLicenseStatus (live Windows integration)", () => {
  windowsIt("enters SETUP_GRACE on the very first call with no license present", () => {
    const status = computeLicenseStatus(tempDataRoot(), new Date());
    expect(status.state).toBe("SETUP_GRACE");
    expect(status.mutationAllowed).toBe(true);
    expect(status.daysRemaining).toBe(14);
  });

  windowsIt("stays SETUP_GRACE with a decreasing day count across calls without a license", () => {
    const dataRoot = tempDataRoot();
    computeLicenseStatus(dataRoot, new Date("2026-01-01T00:00:00.000Z"));
    const later = computeLicenseStatus(dataRoot, new Date("2026-01-06T00:00:00.000Z"));
    expect(later.state).toBe("SETUP_GRACE");
    expect(later.daysRemaining).toBe(9);
  });

  windowsIt(
    "reports VALID for a license correctly signed and bound to this machine's real fingerprint",
    () => {
      const dataRoot = tempDataRoot();
      computeLicenseStatus(dataRoot, new Date());
      const fingerprintScript = resolveFingerprintScriptPath({
        repositoryRoot: process.cwd(),
        dataRoot: undefined,
      });
      const fingerprint = computeMachineFingerprint(fingerprintScript, dataRoot);

      const { publicKeyPem, privateKeyPem } = testKeypair();
      const payload: LicensePayload = {
        payloadVersion: 1,
        keyId: "test-vendor",
        licenseId: "22222222-2222-2222-2222-222222222222",
        customer: "Integration Test Customer",
        issuedAt: new Date().toISOString(),
        expiresAt: null,
        machineFingerprint: fingerprint,
      };
      importSigned(dataRoot, privateKeyPem, payload, { "test-vendor": publicKeyPem });

      const status = computeLicenseStatus(dataRoot, new Date(), { "test-vendor": publicKeyPem });
      expect(status.state).toBe("VALID");
      expect(status.mutationAllowed).toBe(true);
      expect(status.customer).toBe("Integration Test Customer");
      expect(status.maskedFingerprint).toBe(`…${fingerprint.slice(-6)}`);
    },
  );

  windowsIt(
    "reports MACHINE_MISMATCH for a validly-signed license bound to a different machine",
    () => {
      const dataRoot = tempDataRoot();
      computeLicenseStatus(dataRoot, new Date());
      const { publicKeyPem, privateKeyPem } = testKeypair();
      const payload: LicensePayload = {
        payloadVersion: 1,
        keyId: "test-vendor",
        licenseId: "33333333-3333-3333-3333-333333333333",
        customer: "Different Machine Customer",
        issuedAt: new Date().toISOString(),
        expiresAt: null,
        machineFingerprint: "f".repeat(64),
      };
      importSigned(dataRoot, privateKeyPem, payload, { "test-vendor": publicKeyPem });

      const status = computeLicenseStatus(dataRoot, new Date(), { "test-vendor": publicKeyPem });
      expect(status.state).toBe("MACHINE_MISMATCH");
      expect(status.mutationAllowed).toBe(false);
    },
  );

  windowsIt("reports INVALID_SIGNATURE for a license signed under an untrusted key", () => {
    const dataRoot = tempDataRoot();
    computeLicenseStatus(dataRoot, new Date());
    const { privateKeyPem } = testKeypair();
    const payload: LicensePayload = {
      payloadVersion: 1,
      keyId: "untrusted-vendor",
      licenseId: "44444444-4444-4444-4444-444444444444",
      customer: "Untrusted",
      issuedAt: new Date().toISOString(),
      expiresAt: null,
      machineFingerprint: "a".repeat(64),
    };
    // A real upload of this content is now correctly rejected at import time
    // (Phase 35 L2) -- this test instead covers the read-side fact of a file
    // already on disk under a key that isn't (or is no longer) trusted, e.g.
    // after a key rotation.
    writeSignedDirectly(dataRoot, privateKeyPem, payload);

    const status = computeLicenseStatus(dataRoot, new Date(), {});
    expect(status.state).toBe("INVALID_SIGNATURE");
    expect(status.mutationAllowed).toBe(false);
  });
});
