/**
 * Trusted Ed25519 public keys for signed update packages, keyed by keyId.
 * This module is structurally independent of
 * src/server/licensing/public-keys.ts -- there is no shared type or
 * constant, so a license public key can never be passed where an update
 * public key is expected, or vice versa, even by accident. The matching
 * private update-signing key(s) never enter this repository (see
 * scripts/updates/generate-update-keypair.ts and the gitignored
 * .licensing/ directory).
 *
 * Rotation: add a new keyId here without removing a prior one so update
 * packages already signed under the old key continue to verify until they
 * are no longer needed (Phase 34 design, Section 3).
 */
export const TRUSTED_UPDATE_PUBLIC_KEYS: Readonly<Record<string, string>> = {
  "update-vendor-1":
    "-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEAAHa4FE47mEKEVt15uvN380BBTrhn3eNNc9VgyXObNU4=\n-----END PUBLIC KEY-----\n",
};
