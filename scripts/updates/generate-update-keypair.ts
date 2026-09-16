import { generateKeyPairSync } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Vendor-side tooling only. Generates a new Ed25519 keypair for signing
 * update packages -- fully independent of scripts/licensing/'s license-
 * signing keypair (Phase 34 design, Section 3: a separate key namespace,
 * never interchangeable with the license key). The private key is written
 * to the gitignored .licensing/ directory and must never be committed,
 * copied into a release payload, or embedded in the application. Only the
 * printed public key + keyId are meant to be pasted into
 * src/server/updates/update-public-keys.ts.
 *
 * Usage: pnpm tsx scripts/updates/generate-update-keypair.ts <keyId>
 */
const keyId = process.argv[2];
if (!keyId || !/^[a-z0-9-]{1,50}$/.test(keyId)) {
  console.error("Usage: pnpm tsx scripts/updates/generate-update-keypair.ts <keyId>");
  console.error("keyId must be lowercase letters, digits, and hyphens only.");
  process.exit(1);
}

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const licensingDirectory = path.join(repositoryRoot, ".licensing");
mkdirSync(licensingDirectory, { recursive: true });

const privateKeyPath = path.join(licensingDirectory, `update-signing-${keyId}.private.pem`);
if (existsSync(privateKeyPath)) {
  console.error(`Refusing to overwrite an existing private key at ${privateKeyPath}.`);
  process.exit(1);
}

const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const publicKeyPem = publicKey.export({ type: "spki", format: "pem" }).toString();
const privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();

writeFileSync(privateKeyPath, privateKeyPem, { mode: 0o600 });

console.log(`Private update-signing key written to ${privateKeyPath} (never commit this file).`);
console.log("");
console.log(
  "Add this entry to TRUSTED_UPDATE_PUBLIC_KEYS in src/server/updates/update-public-keys.ts:",
);
console.log("");
console.log(`  "${keyId}": ${JSON.stringify(publicKeyPem)},`);
