import { z } from "zod";

import { isUpdateStage, type UpdateStateData } from "../../src/modules/updates/domain/update-state";
import {
  readUpdateState,
  resetUpdateState,
  resolveUpdateStateStorePaths,
  writeUpdateState,
} from "../../src/server/updates/update-state-store";
import { verifyUpdateManifest } from "../../src/server/updates/verify-update-package";

/**
 * Bundled into operations\update-orchestrator.mjs, staged in the stable
 * bootstrap component (Phase 34 design, Section 6/13). Update-HamdFoodsERP.ps1
 * shells out to this for every step that needs real cryptography or the
 * DPAPI-protected update-state store; PowerShell never re-implements either.
 *
 * Usage: node update-orchestrator.mjs <verify-manifest|state-read|state-write|state-reset>
 * The DPAPI bridge script path is always computed directly by the calling
 * PowerShell script (Join-Path $AppRoot 'windows\Dpapi-HamdFoodsERP.ps1'),
 * never resolved here -- resolveDpapiScriptPath()'s dev-vs-installed
 * branching depends on an explicit dataRoot signal this process does not
 * reliably have, and guessing wrong here would silently point state reads/
 * writes at a nonexistent script.
 * stdin (JSON, shape depends on subcommand):
 *   verify-manifest: { manifestJson, signatureBase64 }
 *   state-read:      { dataRoot, scriptPath }
 *   state-write:     { dataRoot, scriptPath, data }
 *   state-reset:     { dataRoot }
 * stdout: one JSON line with the result. Exit code 0 on success, 1 on any
 * failure (including a verification "invalid" result, which is not an
 * exceptional error but must still be distinguishable from success).
 */
const subcommand = process.argv[2];

const stateRequestSchema = z.object({
  dataRoot: z.string().min(1),
  scriptPath: z.string().min(1).optional(),
  data: z.unknown().optional(),
});

try {
  switch (subcommand) {
    case "verify-manifest": {
      const payload = z
        .object({ manifestJson: z.string().min(1), signatureBase64: z.string().min(1) })
        .parse(JSON.parse(await readStandardInput()));
      const result = verifyUpdateManifest(payload);
      console.log(JSON.stringify(result));
      process.exitCode = result.valid ? 0 : 1;
      break;
    }
    case "state-read": {
      const payload = stateRequestSchema.parse(JSON.parse(await readStandardInput()));
      if (!payload.scriptPath) throw new Error("scriptPath is required for state-read.");
      const paths = resolveUpdateStateStorePaths(payload.dataRoot);
      const result = readUpdateState(paths, payload.scriptPath);
      console.log(JSON.stringify(result));
      process.exitCode = 0;
      break;
    }
    case "state-write": {
      const payload = stateRequestSchema.parse(JSON.parse(await readStandardInput()));
      if (!payload.scriptPath) throw new Error("scriptPath is required for state-write.");
      const data = payload.data as UpdateStateData;
      if (!isValidStateShape(data)) throw new Error("Update state payload is invalid.");
      const paths = resolveUpdateStateStorePaths(payload.dataRoot);
      writeUpdateState(paths, payload.scriptPath, data);
      console.log(JSON.stringify({ ok: true }));
      process.exitCode = 0;
      break;
    }
    case "state-reset": {
      const payload = stateRequestSchema.parse(JSON.parse(await readStandardInput()));
      const paths = resolveUpdateStateStorePaths(payload.dataRoot);
      resetUpdateState(paths);
      console.log(JSON.stringify({ ok: true }));
      process.exitCode = 0;
      break;
    }
    default:
      throw new Error("Unknown subcommand.");
  }
} catch (error) {
  console.log(
    JSON.stringify({ ok: false, reason: error instanceof Error ? error.message : "Failed." }),
  );
  process.exitCode = 1;
}

function isValidStateShape(value: unknown): value is UpdateStateData {
  return (
    typeof value === "object" &&
    value !== null &&
    isUpdateStage((value as { stage?: unknown }).stage)
  );
}

async function readStandardInput() {
  let value = "";
  for await (const chunk of process.stdin) {
    value += String(chunk);
    if (value.length > 4_000_000) throw new Error("Input is too large.");
  }
  // Windows PowerShell's redirected StandardInput can prepend a UTF-8 BOM
  // depending on the .NET Framework version's default StreamWriter
  // encoding; strip it defensively rather than depending on a
  // StandardInputEncoding property that is not available on every
  // supported PowerShell 5.1 installation.
  if (value.charCodeAt(0) === 0xfeff) value = value.slice(1);
  if (!value.trim()) throw new Error("Input is required on standard input.");
  return value;
}
