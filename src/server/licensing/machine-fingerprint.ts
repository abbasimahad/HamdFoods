import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

export class MachineFingerprintError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MachineFingerprintError";
  }
}

export type FingerprintPathInputs = {
  repositoryRoot: string;
  dataRoot?: string | undefined;
  cwd?: string | undefined;
};

/** Mirrors src/server/licensing/dpapi.ts's dev-vs-installed script resolution. */
export function resolveFingerprintScriptPath(input: FingerprintPathInputs): string {
  if (!input.dataRoot) {
    return path.join(input.repositoryRoot, "installer", "scripts", "Fingerprint-HamdFoodsERP.ps1");
  }
  const cwd = input.cwd ?? process.cwd();
  const appRoot = path.dirname(cwd);
  return path.join(appRoot, "windows", "Fingerprint-HamdFoodsERP.ps1");
}

function resolvePowerShellExecutable(): string {
  const systemRoot = process.env.SystemRoot ?? "C:\\Windows";
  return path.join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
}

/**
 * SHA-256 of "<MachineGuid>|<VolumeSerialNumber>", hex-encoded. Non-secret
 * and stable across application reinstalls on the same machine; changes
 * only on an OS reimage or disk replacement, which is the intended trigger
 * for MACHINE_MISMATCH (see the Phase 33 design's Section 3).
 */
export function computeMachineFingerprint(scriptPath: string, dataRoot: string): string {
  if (process.platform !== "win32")
    throw new MachineFingerprintError("Machine fingerprinting is only available on win32.");
  if (!existsSync(scriptPath))
    throw new MachineFingerprintError("The fingerprint script is missing.");

  const powershell = resolvePowerShellExecutable();
  const result = spawnSync(
    powershell,
    [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      scriptPath,
      "-DataRoot",
      dataRoot,
    ],
    { encoding: "utf8", windowsHide: true, timeout: 15_000 },
  );

  if (result.error)
    throw new MachineFingerprintError(
      `Fingerprint script could not be started: ${result.error.message}`,
    );
  if (result.status !== 0) throw new MachineFingerprintError("Fingerprint script failed.");
  const output = result.stdout.trim();
  if (!output.includes("|"))
    throw new MachineFingerprintError("Fingerprint script returned no output.");
  return createHash("sha256").update(output, "utf8").digest("hex");
}
