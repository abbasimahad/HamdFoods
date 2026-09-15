import { createPrivateKey, createPublicKey, sign, verify } from "node:crypto";

/**
 * Thin wrapper around Node's built-in Ed25519 support. No third-party crypto
 * dependency is introduced. Signing is used only by vendor-side release
 * tooling (see scripts/licensing/); the runtime only ever verifies.
 */
export function verifyEd25519(input: {
  message: string;
  signatureBase64: string;
  publicKeyPem: string;
}): boolean {
  try {
    const publicKey = createPublicKey(input.publicKeyPem);
    return verify(
      null,
      Buffer.from(input.message, "utf8"),
      publicKey,
      Buffer.from(input.signatureBase64, "base64"),
    );
  } catch {
    return false;
  }
}

export function signEd25519(input: { message: string; privateKeyPem: string }): string {
  const privateKey = createPrivateKey(input.privateKeyPem);
  const signature = sign(null, Buffer.from(input.message, "utf8"), privateKey);
  return signature.toString("base64");
}
