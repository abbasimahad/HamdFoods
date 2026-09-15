/**
 * Trusted Ed25519 public keys, keyed by keyId. Public keys are not secret
 * and are safe to embed as literals -- the matching private keys never
 * enter this repository (see scripts/licensing/generate-keypair.ts and
 * .licensing/, which is gitignored).
 *
 * Rotation: add a new keyId here without removing a prior one so licenses
 * already signed under the old key continue to verify until they expire
 * (see the Phase 33 design, Section 11).
 */
export const TRUSTED_LICENSE_PUBLIC_KEYS: Readonly<Record<string, string>> = {
  "hamdfoods-vendor-1":
    "-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEAPo2E8C0P3aVblJpRwXdE7Z80t4VAFTFmfjGpsrQiy0U=\n-----END PUBLIC KEY-----\n",
};
