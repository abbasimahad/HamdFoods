import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

import {
  canonicalizeUpdateManifest,
  parseUpdateManifest,
  type UpdateManifest,
} from "../../src/modules/updates/domain/update-manifest";
import { signEd25519 } from "../../src/server/licensing/ed25519";

/**
 * Vendor-side tooling only. Builds and signs a HamdFoodsERP-Update-<toVersion>.hfupdate
 * package from a prepared payload directory (payload/app, payload/operations,
 * payload/windows, and optionally payload/runtime). Never run as part of the
 * installed application; the private key path is supplied by the operator
 * and is expected to live outside the repository (see
 * scripts/updates/generate-update-keypair.ts).
 *
 * Usage:
 *   pnpm tsx scripts/updates/sign-update-package.ts \
 *     --payload-dir <dir containing payload/...> \
 *     --private-key <path> \
 *     --key-id <keyId> \
 *     --from-version 0.1.0 --to-version 0.2.0 \
 *     --node-version 24.11.1 \
 *     --schema-compatible true|false \
 *     [--node-runtime-included] \
 *     --notes "Release notes summary" \
 *     --out HamdFoodsERP-Update-0.2.0.hfupdate
 *
 * payload-dir must contain a "payload" subdirectory whose contents are
 * exactly what should be extracted (payload/app/..., payload/operations/...,
 * etc.) -- this mirrors the installer's own payload/{app,operations,
 * windows,runtime} shape.
 */
function readArg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}
function requireArg(name: string): string {
  const value = readArg(name);
  if (!value) {
    console.error(`Missing required --${name}.`);
    process.exit(1);
  }
  return value;
}

const payloadDir = requireArg("payload-dir");
const privateKeyPath = requireArg("private-key");
const keyId = requireArg("key-id");
const fromVersion = requireArg("from-version");
const toVersion = requireArg("to-version");
const requiredNodeVersion = requireArg("node-version");
const schemaCompatibleRaw = requireArg("schema-compatible");
const notes = readArg("notes") ?? "";
const outPath = requireArg("out");
const nodeRuntimeIncluded = process.argv.includes("--node-runtime-included");

if (schemaCompatibleRaw !== "true" && schemaCompatibleRaw !== "false") {
  console.error("--schema-compatible must be exactly 'true' or 'false'.");
  process.exit(1);
}

const payloadRoot = path.join(payloadDir, "payload");
if (!existsSync(payloadRoot)) {
  console.error(`Expected a "payload" subdirectory under ${payloadDir}.`);
  process.exit(1);
}

function listFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) listFiles(full, out);
    else out.push(full);
  }
  return out;
}

// Relative paths always use forward slashes: the zip format specifies "/"
// as the entry separator, but some Windows zip tools (Compress-Archive
// included, confirmed during a real update drill) can emit backslashes --
// the manifest is the authoritative, signed contract, so it is always
// built with forward slashes regardless of what any zip tool later does;
// the extraction side normalizes to match.
const files = listFiles(payloadDir).map((absolute) => {
  const relative = path.relative(payloadDir, absolute).split(path.sep).join("/");
  const bytes = readFileSync(absolute);
  return {
    path: relative,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    size: statSync(absolute).size,
  };
});

const manifest: UpdateManifest = parseUpdateManifest({
  manifestVersion: 1,
  keyId,
  fromVersion,
  toVersion,
  minimumInstallerSchemaVersion: 1,
  nodeRuntimeIncluded,
  requiredNodeVersion,
  previousVersionCompatibleWithNewSchema: schemaCompatibleRaw === "true",
  issuedAt: new Date().toISOString(),
  releaseNotesSummary: notes,
  files,
});

const privateKeyPem = readFileSync(privateKeyPath, "utf8");
const signature = signEd25519({ message: canonicalizeUpdateManifest(manifest), privateKeyPem });

const stagingDir = path.join(payloadDir, ".sign-staging");
rmSync(stagingDir, { recursive: true, force: true });
mkdirSync(stagingDir, { recursive: true });
writeFileSync(path.join(stagingDir, "manifest.json"), JSON.stringify(manifest));
writeFileSync(path.join(stagingDir, "manifest.sig"), signature);

const zipTemp = `${outPath}.zip`;
rmSync(zipTemp, { force: true });
rmSync(outPath, { force: true });
execFileSync(
  String.raw`C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe`,
  [
    "-NoLogo",
    "-NoProfile",
    "-NonInteractive",
    "-ExecutionPolicy",
    "Bypass",
    "-Command",
    `Compress-Archive -Path '${stagingDir}\\manifest.json','${stagingDir}\\manifest.sig','${payloadRoot}' -DestinationPath '${zipTemp}' -Force`,
  ],
  { stdio: "inherit" },
);
execFileSync(String.raw`C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe`, [
  "-NoLogo",
  "-NoProfile",
  "-NonInteractive",
  "-Command",
  `Move-Item -LiteralPath '${zipTemp}' -Destination '${outPath}' -Force`,
]);
rmSync(stagingDir, { recursive: true, force: true });

console.log(
  `Signed update package written to ${outPath} (${fromVersion} -> ${toVersion}, ${files.length} files).`,
);
