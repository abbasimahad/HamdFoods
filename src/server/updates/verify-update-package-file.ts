import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, statSync } from "node:fs";
import path from "node:path";

import { buildSync } from "esbuild";

import type { VerifyManifestResult } from "./verify-update-package";

export class UpdatePackageVerificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UpdatePackageVerificationError";
  }
}

export type OrchestratorRuntime = { node: string; script: string };

export type OrchestratorRuntimeInputs = {
  repositoryRoot: string;
  dataRoot?: string | undefined;
  cwd?: string | undefined;
};

/**
 * Resolves the Node runtime and update-orchestrator entry point to invoke.
 * A real installation always sets HAMDFOODS_DATA_ROOT (see
 * Run-HamdFoodsERP.ps1) and already has the esbuild-bundled
 * operations\update-orchestrator.mjs staged next to a bundled Node runtime
 * (scripts/installer.ts's stageOperationalBundles()). Outside that -- local
 * development, tests, or `pnpm production:*` from a checkout -- there is no
 * pre-bundled .mjs, so this builds one on demand with esbuild (the exact
 * same settings scripts/installer.ts uses) into a cached, gitignored
 * location, memoized by source mtime so repeated calls in the same run are
 * cheap.
 */
export function resolveOrchestratorRuntime(input: OrchestratorRuntimeInputs): OrchestratorRuntime {
  if (input.dataRoot) {
    const cwd = input.cwd ?? process.cwd();
    const appRoot = path.dirname(cwd);
    return {
      node: path.join(appRoot, "runtime", "node", "node.exe"),
      script: path.join(appRoot, "operations", "update-orchestrator.mjs"),
    };
  }
  const script = ensureDevOrchestratorBundle(input.repositoryRoot);
  return { node: process.execPath, script };
}

function ensureDevOrchestratorBundle(repositoryRoot: string): string {
  const entryPoint = path.join(repositoryRoot, "scripts", "updates", "update-orchestrator-cli.ts");
  const cacheDirectory = path.join(repositoryRoot, ".update-runtime");
  const bundlePath = path.join(cacheDirectory, "update-orchestrator.mjs");

  const entryMtime = statSync(entryPoint).mtimeMs;
  const bundleMtime = existsSync(bundlePath) ? statSync(bundlePath).mtimeMs : -1;
  if (bundleMtime >= entryMtime) return bundlePath;

  mkdirSync(cacheDirectory, { recursive: true });
  buildSync({
    entryPoints: [entryPoint],
    outfile: bundlePath,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node24",
    packages: "external",
    conditions: ["react-server", "node", "import"],
    sourcemap: false,
    legalComments: "none",
    logLevel: "silent",
  });
  return bundlePath;
}

export type VerifyScriptInputs = {
  repositoryRoot: string;
  dataRoot?: string | undefined;
  cwd?: string | undefined;
};

/** Mirrors src/server/licensing/dpapi.ts's dev-vs-installed script resolution. */
export function resolveVerifyPackageScriptPath(input: VerifyScriptInputs): string {
  if (!input.dataRoot) {
    return path.join(
      input.repositoryRoot,
      "installer",
      "scripts",
      "Verify-UpdatePackage-HamdFoodsERP.ps1",
    );
  }
  const cwd = input.cwd ?? process.cwd();
  const appRoot = path.dirname(cwd);
  return path.join(appRoot, "windows", "Verify-UpdatePackage-HamdFoodsERP.ps1");
}

function resolvePowerShellExecutable(): string {
  const systemRoot = process.env.SystemRoot ?? "C:\\Windows";
  return path.join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
}

/**
 * Verifies a staged .hfupdate package file by shelling out to
 * Verify-UpdatePackage-HamdFoodsERP.ps1 (reads only manifest.json/
 * manifest.sig out of the zip, never payload/), which in turn shells out
 * to the resolved Node runtime for the actual Ed25519 verification -- the
 * exact same script Update-HamdFoodsERP.ps1 uses for its own independent
 * re-verification, so there is exactly one code path for "is this package
 * signature valid," not two that could drift.
 */
export function verifyUpdatePackageFile(
  packagePath: string,
  scriptPath: string,
  orchestrator: OrchestratorRuntime,
): VerifyManifestResult {
  if (process.platform !== "win32")
    throw new UpdatePackageVerificationError(
      "Update package verification is only available on win32.",
    );
  if (!existsSync(scriptPath))
    throw new UpdatePackageVerificationError("The update verification script is missing.");
  if (!existsSync(packagePath))
    throw new UpdatePackageVerificationError("The update package file is missing.");

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
      "-PackagePath",
      packagePath,
      "-VerifierNode",
      orchestrator.node,
      "-VerifierScript",
      orchestrator.script,
    ],
    { encoding: "utf8", windowsHide: true, timeout: 30_000 },
  );

  if (result.error)
    throw new UpdatePackageVerificationError(
      `Update package verification could not start: ${result.error.message}`,
    );
  const output = result.stdout.trim();
  if (!output)
    throw new UpdatePackageVerificationError("Update package verification returned no output.");
  try {
    return JSON.parse(output) as VerifyManifestResult;
  } catch {
    throw new UpdatePackageVerificationError(
      "Update package verification returned an invalid result.",
    );
  }
}
