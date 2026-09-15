import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { computeMachineFingerprint, resolveFingerprintScriptPath } from "./machine-fingerprint";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const windowsIt = process.platform === "win32" ? it : it.skip;

describe("resolveFingerprintScriptPath", () => {
  it("resolves the repository installer script when no data root is configured", () => {
    expect(resolveFingerprintScriptPath({ repositoryRoot })).toBe(
      path.join(repositoryRoot, "installer", "scripts", "Fingerprint-HamdFoodsERP.ps1"),
    );
  });

  it("resolves the sibling installed windows directory when a data root is configured", () => {
    const resolved = resolveFingerprintScriptPath({
      repositoryRoot,
      dataRoot: "C:\\ProgramData\\HamdFoodsERP",
      cwd: "C:\\Program Files\\HamdFoodsERP\\app",
    });
    expect(resolved).toBe("C:\\Program Files\\HamdFoodsERP\\windows\\Fingerprint-HamdFoodsERP.ps1");
  });
});

describe("computeMachineFingerprint (live Windows bridge)", () => {
  const scriptPath = path.join(
    repositoryRoot,
    "installer",
    "scripts",
    "Fingerprint-HamdFoodsERP.ps1",
  );

  windowsIt("returns a stable 64-character hex digest for this machine", () => {
    const first = computeMachineFingerprint(scriptPath, "C:\\ProgramData");
    const second = computeMachineFingerprint(scriptPath, "C:\\ProgramData");
    expect(first).toMatch(/^[a-f0-9]{64}$/);
    expect(first).toBe(second);
  });
});
