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
import {
  LicenseFileError,
  importLicenseFile,
  readLicenseFileVerdict,
  resolveLicenseFilePaths,
} from "./license-file-store";

function keypair() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  return {
    publicKeyPem: publicKey.export({ type: "spki", format: "pem" }).toString(),
    privateKeyPem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
  };
}

function payload(overrides: Partial<LicensePayload> = {}): LicensePayload {
  return {
    payloadVersion: 1,
    keyId: "test-key",
    licenseId: "11111111-1111-1111-1111-111111111111",
    customer: "Hamd Foods",
    issuedAt: "2026-01-01T00:00:00.000Z",
    expiresAt: null,
    machineFingerprint: "a".repeat(32),
    ...overrides,
  };
}

function signedLicenseFile(privateKeyPem: string, licensePayload: LicensePayload) {
  const signature = signEd25519({
    message: canonicalizeLicensePayload(licensePayload),
    privateKeyPem,
  });
  return JSON.stringify({ payload: licensePayload, signature });
}

let tempDirectories: string[] = [];
function tempDataRoot() {
  const dir = mkdtempSync(path.join(os.tmpdir(), "hamdfoods-license-file-"));
  tempDirectories.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of tempDirectories) rmSync(dir, { recursive: true, force: true });
  tempDirectories = [];
});

describe("readLicenseFileVerdict", () => {
  it("reports absent when no file exists", () => {
    const paths = resolveLicenseFilePaths(tempDataRoot());
    expect(readLicenseFileVerdict(paths, {})).toEqual({ kind: "absent" });
  });

  it("verifies a correctly signed license under a trusted key", () => {
    const { publicKeyPem, privateKeyPem } = keypair();
    const paths = resolveLicenseFilePaths(tempDataRoot());
    const licensePayload = payload({ keyId: "vendor-1" });
    importLicenseFile(paths, signedLicenseFile(privateKeyPem, licensePayload));
    const verdict = readLicenseFileVerdict(paths, { "vendor-1": publicKeyPem });
    expect(verdict).toEqual({ kind: "valid", payload: licensePayload });
  });

  it("reports invalid-signature for an untrusted keyId", () => {
    const { privateKeyPem } = keypair();
    const paths = resolveLicenseFilePaths(tempDataRoot());
    importLicenseFile(paths, signedLicenseFile(privateKeyPem, payload({ keyId: "unknown-key" })));
    expect(readLicenseFileVerdict(paths, { "vendor-1": keypair().publicKeyPem })).toEqual({
      kind: "invalid-signature",
    });
  });

  it("reports invalid-signature for a tampered payload", () => {
    const { publicKeyPem, privateKeyPem } = keypair();
    const paths = resolveLicenseFilePaths(tempDataRoot());
    const licensePayload = payload({ keyId: "vendor-1" });
    const signature = signEd25519({
      message: canonicalizeLicensePayload(licensePayload),
      privateKeyPem,
    });
    const tampered = { payload: { ...licensePayload, customer: "Attacker" }, signature };
    mkdirSync(paths.configDirectory, { recursive: true });
    writeFileSync(paths.licenseFile, JSON.stringify(tampered));
    expect(readLicenseFileVerdict(paths, { "vendor-1": publicKeyPem })).toEqual({
      kind: "invalid-signature",
    });
  });

  it("reports invalid-signature for malformed JSON", () => {
    const paths = resolveLicenseFilePaths(tempDataRoot());
    mkdirSync(paths.configDirectory, { recursive: true });
    writeFileSync(paths.licenseFile, "{ not json");
    expect(readLicenseFileVerdict(paths, {})).toEqual({ kind: "invalid-signature" });
  });
});

describe("importLicenseFile", () => {
  it("rejects content that is not valid JSON", () => {
    const paths = resolveLicenseFilePaths(tempDataRoot());
    expect(() => importLicenseFile(paths, "not json")).toThrow(LicenseFileError);
  });

  it("rejects JSON missing payload/signature", () => {
    const paths = resolveLicenseFilePaths(tempDataRoot());
    expect(() => importLicenseFile(paths, JSON.stringify({ foo: "bar" }))).toThrow(
      LicenseFileError,
    );
  });
});
