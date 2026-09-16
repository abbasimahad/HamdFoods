import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { createInitialLicenseStateData } from "@/modules/licensing/domain/license";

import {
  readLicenseState,
  resetLicenseState,
  resolveLicenseStateStorePaths,
  writeLicenseState,
} from "./license-state-store";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const scriptPath = path.join(repositoryRoot, "installer", "scripts", "Dpapi-HamdFoodsERP.ps1");
const windowsIt = process.platform === "win32" ? it : it.skip;

let tempDirectories: string[] = [];
function tempDataRoot() {
  const dir = mkdtempSync(path.join(os.tmpdir(), "hamdfoods-license-state-"));
  tempDirectories.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of tempDirectories) rmSync(dir, { recursive: true, force: true });
  tempDirectories = [];
});

describe("license state store (live Windows DPAPI)", () => {
  windowsIt("reports absent when neither file exists", () => {
    const paths = resolveLicenseStateStorePaths(tempDataRoot());
    expect(readLicenseState(paths, scriptPath)).toEqual({ kind: "absent" });
  });

  windowsIt("round-trips a written state through read", () => {
    const paths = resolveLicenseStateStorePaths(tempDataRoot());
    const data = createInitialLicenseStateData(new Date("2026-01-01T00:00:00.000Z"));
    writeLicenseState(paths, scriptPath, data);
    const result = readLicenseState(paths, scriptPath);
    expect(result).toEqual({ kind: "ok", data });
  });

  windowsIt("detects a hand-edited state file as corrupted", () => {
    const paths = resolveLicenseStateStorePaths(tempDataRoot());
    writeLicenseState(paths, scriptPath, createInitialLicenseStateData(new Date()));
    const raw = JSON.parse(readFileSync(paths.dataFile, "utf8"));
    raw.state.setupGraceAnchor = "2020-01-01T00:00:00.000Z";
    writeFileSync(paths.dataFile, JSON.stringify(raw));
    expect(readLicenseState(paths, scriptPath)).toEqual({ kind: "corrupted" });
  });

  windowsIt("detects a deleted key file (asymmetric presence) as corrupted", () => {
    const paths = resolveLicenseStateStorePaths(tempDataRoot());
    writeLicenseState(paths, scriptPath, createInitialLicenseStateData(new Date()));
    rmSync(paths.keyFile);
    expect(readLicenseState(paths, scriptPath)).toEqual({ kind: "corrupted" });
  });

  windowsIt("fails to unprotect a key file copied from a different protection context", () => {
    const paths = resolveLicenseStateStorePaths(tempDataRoot());
    writeLicenseState(paths, scriptPath, createInitialLicenseStateData(new Date()));
    writeFileSync(paths.keyFile, Buffer.from("not-a-real-dpapi-blob").toString("base64"));
    expect(readLicenseState(paths, scriptPath)).toEqual({ kind: "corrupted" });
  });

  windowsIt("resetLicenseState clears both files so a fresh state can be generated", () => {
    const paths = resolveLicenseStateStorePaths(tempDataRoot());
    writeLicenseState(paths, scriptPath, createInitialLicenseStateData(new Date()));
    resetLicenseState(paths);
    expect(readLicenseState(paths, scriptPath)).toEqual({ kind: "absent" });
  });

  windowsIt("updates written state on a second write using the same key", () => {
    const paths = resolveLicenseStateStorePaths(tempDataRoot());
    const first = createInitialLicenseStateData(new Date("2026-01-01T00:00:00.000Z"));
    writeLicenseState(paths, scriptPath, first);
    const second = { ...first, lastObservedTime: "2026-01-02T00:00:00.000Z" };
    writeLicenseState(paths, scriptPath, second);
    expect(readLicenseState(paths, scriptPath)).toEqual({ kind: "ok", data: second });
  });
});
