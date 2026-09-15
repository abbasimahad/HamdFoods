import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

import {
  canonicalizeLicensePayload,
  parseLicensePayload,
  type LicensePayload,
} from "../../src/modules/licensing/domain/license";
import { signEd25519 } from "../../src/server/licensing/ed25519";

/**
 * Vendor-side tooling only. Reads the activation request the customer sent
 * (see src/server/licensing/activation-request.ts / the Administration ->
 * License panel) and the vendor's private key, and writes a signed .lic
 * file. Never run as part of the installed application or CI; the private
 * key path is supplied by the operator and is expected to live outside the
 * repository (see scripts/licensing/generate-keypair.ts).
 *
 * Usage:
 *   pnpm tsx scripts/licensing/sign-license.ts \
 *     --activation-request <path> \
 *     --private-key <path> \
 *     --key-id <keyId> \
 *     --customer "Customer Name" \
 *     --expires-at 2027-01-01T00:00:00.000Z \
 *     --out license.lic
 */
function readArg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

const activationRequestPath = requireArg("activation-request");
const privateKeyPath = requireArg("private-key");
const keyId = requireArg("key-id");
const customer = requireArg("customer");
const expiresAtRaw = readArg("expires-at");
const outPath = requireArg("out");

function requireArg(name: string): string {
  const value = readArg(name);
  if (!value) {
    console.error(`Missing required --${name}.`);
    process.exit(1);
  }
  return value;
}

const activationRequest: unknown = JSON.parse(readFileSync(activationRequestPath, "utf8"));
if (
  typeof activationRequest !== "object" ||
  activationRequest === null ||
  typeof (activationRequest as Record<string, unknown>).machineFingerprint !== "string"
) {
  console.error("Activation request is missing machineFingerprint.");
  process.exit(1);
}
const machineFingerprint = (activationRequest as { machineFingerprint: string }).machineFingerprint;

const expiresAt = expiresAtRaw ? new Date(expiresAtRaw).toISOString() : null;
if (expiresAtRaw && Number.isNaN(Date.parse(expiresAtRaw))) {
  console.error("--expires-at must be a valid date.");
  process.exit(1);
}

const payload: LicensePayload = parseLicensePayload({
  payloadVersion: 1,
  keyId,
  licenseId: randomUUID(),
  customer,
  issuedAt: new Date().toISOString(),
  expiresAt,
  machineFingerprint,
});

const privateKeyPem = readFileSync(privateKeyPath, "utf8");
const signature = signEd25519({ message: canonicalizeLicensePayload(payload), privateKeyPem });

writeFileSync(outPath, JSON.stringify({ payload, signature }, null, 2));
console.log(`Signed license written to ${outPath} for machine fingerprint ${machineFingerprint}.`);
