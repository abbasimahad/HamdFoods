import { generateKeyPairSync } from "node:crypto";
import { mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

import { afterEach, describe, expect, it } from "vitest";

import {
  canonicalizeUpdateManifest,
  type UpdateManifest,
} from "@/modules/updates/domain/update-manifest";
import { signEd25519 } from "@/server/licensing/ed25519";

import {
  resolveOrchestratorRuntime,
  resolveVerifyPackageScriptPath,
  verifyUpdatePackageFile,
} from "./verify-update-package-file";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const windowsIt = process.platform === "win32" ? it : it.skip;

let tempDirectories: string[] = [];
function tempDir() {
  const dir = mkdtempSync(path.join(os.tmpdir(), "hamdfoods-update-pkg-"));
  tempDirectories.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of tempDirectories) rmSync(dir, { recursive: true, force: true });
  tempDirectories = [];
});

function manifest(overrides: Partial<UpdateManifest> = {}): UpdateManifest {
  return {
    manifestVersion: 1,
    keyId: "test-update-key",
    fromVersion: "0.1.0",
    toVersion: "0.2.0",
    minimumInstallerSchemaVersion: 1,
    nodeRuntimeIncluded: false,
    requiredNodeVersion: "24.11.1",
    previousVersionCompatibleWithNewSchema: true,
    issuedAt: "2026-01-01T00:00:00.000Z",
    releaseNotesSummary: "Test",
    files: [{ path: "payload/app/server.js", sha256: "a".repeat(64), size: 4 }],
    ...overrides,
  };
}

/** Builds a real .hfupdate zip via PowerShell's Compress-Archive (no npm zip dependency). */
function buildPackageZip(
  manifestValue: UpdateManifest,
  signatureBase64: string,
  extraFiles: Record<string, string> = {},
): string {
  const stagingDir = tempDir();
  writeFileSync(path.join(stagingDir, "manifest.json"), JSON.stringify(manifestValue));
  writeFileSync(path.join(stagingDir, "manifest.sig"), signatureBase64);
  for (const [relativePath, content] of Object.entries(extraFiles)) {
    const fullPath = path.join(stagingDir, relativePath);
    mkdirSync(path.dirname(fullPath), { recursive: true });
    writeFileSync(fullPath, content);
  }
  // Compress-Archive requires a .zip extension; a .hfupdate package is a
  // plain zip under a different extension (read by content, not name), so
  // build as .zip then rename to match the real package convention.
  const zipPath = path.join(tempDir(), "package.zip");
  const finalPath = path.join(path.dirname(zipPath), "package.hfupdate");
  const systemRoot = process.env.SystemRoot ?? "C:\\Windows";
  const powershell = path.join(
    systemRoot,
    "System32",
    "WindowsPowerShell",
    "v1.0",
    "powershell.exe",
  );
  const result = spawnSync(
    powershell,
    [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      `Compress-Archive -Path '${stagingDir}\\*' -DestinationPath '${zipPath}' -Force`,
    ],
    { encoding: "utf8" },
  );
  if (result.status !== 0) throw new Error(`Compress-Archive failed: ${result.stderr}`);
  renameSync(zipPath, finalPath);
  return finalPath;
}

describe("resolveOrchestratorRuntime / resolveVerifyPackageScriptPath", () => {
  it("resolves dev-mode paths when no data root is configured", () => {
    const scriptPath = resolveVerifyPackageScriptPath({ repositoryRoot });
    expect(scriptPath).toBe(
      path.join(repositoryRoot, "installer", "scripts", "Verify-UpdatePackage-HamdFoodsERP.ps1"),
    );
  });

  it("resolves the sibling installed windows directory when a data root is configured", () => {
    const scriptPath = resolveVerifyPackageScriptPath({
      repositoryRoot,
      dataRoot: "C:\\ProgramData\\HamdFoodsERP",
      cwd: "C:\\Program Files\\HamdFoodsERP\\app",
    });
    expect(scriptPath).toBe(
      "C:\\Program Files\\HamdFoodsERP\\windows\\Verify-UpdatePackage-HamdFoodsERP.ps1",
    );
  });

  it("resolves the installed bundled node/operations paths when a data root is configured", () => {
    const runtime = resolveOrchestratorRuntime({
      repositoryRoot,
      dataRoot: "C:\\ProgramData\\HamdFoodsERP",
      cwd: "C:\\Program Files\\HamdFoodsERP\\app",
    });
    expect(runtime.node).toBe("C:\\Program Files\\HamdFoodsERP\\runtime\\node\\node.exe");
    expect(runtime.script).toBe(
      "C:\\Program Files\\HamdFoodsERP\\operations\\update-orchestrator.mjs",
    );
  });
});

describe("verifyUpdatePackageFile (live Windows integration)", () => {
  windowsIt(
    "runs the real zip-read/PowerShell/Node pipeline end to end and correctly rejects an untrusted key",
    () => {
      const { privateKey } = generateKeyPairSync("ed25519");
      const privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
      const value = manifest({ keyId: "test-update-key" });
      const signatureBase64 = signEd25519({
        message: canonicalizeUpdateManifest(value),
        privateKeyPem,
      });
      const zipPath = buildPackageZip(value, signatureBase64);

      const scriptPath = resolveVerifyPackageScriptPath({ repositoryRoot });
      const orchestrator = resolveOrchestratorRuntime({ repositoryRoot });

      // The packaged verifier always trusts only the real, shipped
      // TRUSTED_UPDATE_PUBLIC_KEYS (there is no override for the real
      // binary path), so a manifest signed by a throwaway test key is
      // correctly rejected here -- proving the full zip-read -> PowerShell
      // -> bundled-Node -> verifyUpdateManifest round trip actually runs,
      // not just that the pure function works (already covered in
      // verify-update-package.test.ts with real key injection, and
      // interactively confirmed end to end against the real vendor key
      // during implementation).
      const result = verifyUpdatePackageFile(zipPath, scriptPath, orchestrator);
      expect(result.valid).toBe(false);
      if (!result.valid) expect(result.reason).toMatch(/untrusted|unknown/i);
    },
  );

  windowsIt("rejects a package missing manifest.sig", () => {
    const zipDir = tempDir();
    writeFileSync(path.join(zipDir, "manifest.json"), JSON.stringify(manifest()));
    const zipPath = path.join(tempDir(), "bad.zip");
    const finalPath = path.join(path.dirname(zipPath), "bad.hfupdate");
    const systemRoot = process.env.SystemRoot ?? "C:\\Windows";
    const powershell = path.join(
      systemRoot,
      "System32",
      "WindowsPowerShell",
      "v1.0",
      "powershell.exe",
    );
    spawnSync(powershell, [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      `Compress-Archive -Path '${zipDir}\\*' -DestinationPath '${zipPath}' -Force`,
    ]);
    renameSync(zipPath, finalPath);

    const scriptPath = resolveVerifyPackageScriptPath({ repositoryRoot });
    const orchestrator = resolveOrchestratorRuntime({ repositoryRoot });
    const result = verifyUpdatePackageFile(finalPath, scriptPath, orchestrator);
    expect(result.valid).toBe(false);
  });
});
