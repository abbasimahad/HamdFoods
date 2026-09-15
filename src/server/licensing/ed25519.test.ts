import { generateKeyPairSync } from "node:crypto";

import { describe, expect, it } from "vitest";

import { signEd25519, verifyEd25519 } from "./ed25519";

function keypair() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  return {
    publicKeyPem: publicKey.export({ type: "spki", format: "pem" }).toString(),
    privateKeyPem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
  };
}

describe("Ed25519 sign/verify", () => {
  it("verifies a signature produced with the matching private key", () => {
    const { publicKeyPem, privateKeyPem } = keypair();
    const signatureBase64 = signEd25519({ message: "hello", privateKeyPem });
    expect(verifyEd25519({ message: "hello", signatureBase64, publicKeyPem })).toBe(true);
  });

  it("rejects a signature under a different public key", () => {
    const { privateKeyPem } = keypair();
    const other = keypair();
    const signatureBase64 = signEd25519({ message: "hello", privateKeyPem });
    expect(
      verifyEd25519({ message: "hello", signatureBase64, publicKeyPem: other.publicKeyPem }),
    ).toBe(false);
  });

  it("rejects a tampered message", () => {
    const { publicKeyPem, privateKeyPem } = keypair();
    const signatureBase64 = signEd25519({ message: "hello", privateKeyPem });
    expect(verifyEd25519({ message: "goodbye", signatureBase64, publicKeyPem })).toBe(false);
  });

  it("rejects a malformed signature without throwing", () => {
    const { publicKeyPem } = keypair();
    expect(verifyEd25519({ message: "hello", signatureBase64: "not-base64!!", publicKeyPem })).toBe(
      false,
    );
  });

  it("rejects a malformed public key without throwing", () => {
    expect(
      verifyEd25519({ message: "hello", signatureBase64: "AAAA", publicKeyPem: "not a key" }),
    ).toBe(false);
  });
});
