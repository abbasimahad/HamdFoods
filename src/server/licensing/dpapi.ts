import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

export class DpapiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DpapiError";
  }
}

export type DpapiPathInputs = {
  repositoryRoot: string;
  dataRoot?: string | undefined;
  cwd?: string | undefined;
};

/**
 * Resolves the Dpapi-HamdFoodsERP.ps1 bridge script. In the repository (dev,
 * test, or `pnpm production:*` run from a checkout) it lives under
 * installer/scripts. In an installed runtime the process working directory
 * is <AppRoot>\app (see Run-HamdFoodsERP.ps1), and the script was staged as
 * a sibling under <AppRoot>\windows by scripts/installer.ts.
 */
export function resolveDpapiScriptPath(input: DpapiPathInputs): string {
  if (!input.dataRoot) {
    return path.join(input.repositoryRoot, "installer", "scripts", "Dpapi-HamdFoodsERP.ps1");
  }
  const cwd = input.cwd ?? process.cwd();
  const appRoot = path.dirname(cwd);
  return path.join(appRoot, "windows", "Dpapi-HamdFoodsERP.ps1");
}

function resolvePowerShellExecutable(): string {
  const systemRoot = process.env.SystemRoot ?? "C:\\Windows";
  return path.join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
}

function runDpapi(mode: "Protect" | "Unprotect", inputBase64: string, scriptPath: string): string {
  if (process.platform !== "win32")
    throw new DpapiError("Windows DPAPI is only available on win32.");
  if (!existsSync(scriptPath)) throw new DpapiError("The DPAPI bridge script is missing.");

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
      "-Mode",
      mode,
    ],
    { input: inputBase64, encoding: "utf8", windowsHide: true, timeout: 15_000 },
  );

  if (result.error)
    throw new DpapiError(`DPAPI bridge could not be started: ${result.error.message}`);
  if (result.status !== 0) throw new DpapiError("DPAPI bridge operation failed.");
  const output = result.stdout.trim();
  if (!output) throw new DpapiError("DPAPI bridge returned no output.");
  return output;
}

export function dpapiProtect(plaintextBase64: string, scriptPath: string): string {
  return runDpapi("Protect", plaintextBase64, scriptPath);
}

export function dpapiUnprotect(protectedBase64: string, scriptPath: string): string {
  return runDpapi("Unprotect", protectedBase64, scriptPath);
}
