import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { createInitialUpdateState } from "@/modules/updates/domain/update-state";

import {
  readUpdateState,
  resetUpdateState,
  resolveUpdateStateStorePaths,
  writeUpdateState,
} from "./update-state-store";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const scriptPath = path.join(repositoryRoot, "installer", "scripts", "Dpapi-HamdFoodsERP.ps1");
const windowsIt = process.platform === "win32" ? it : it.skip;

let tempDirectories: string[] = [];
function tempDataRoot() {
  const dir = mkdtempSync(path.join(os.tmpdir(), "hamdfoods-update-state-"));
  tempDirectories.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of tempDirectories) rmSync(dir, { recursive: true, force: true });
  tempDirectories = [];
});

function sampleState() {
  return createInitialUpdateState({
    updateId: "upd-1",
    packageId: "pkg-1",
    fromVersion: "0.1.0",
    toVersion: "0.2.0",
    now: new Date("2026-01-01T00:00:00.000Z"),
  });
}

describe("update state store (live Windows DPAPI)", () => {
  windowsIt("reports absent when neither file exists", () => {
    const paths = resolveUpdateStateStorePaths(tempDataRoot());
    expect(readUpdateState(paths, scriptPath)).toEqual({ kind: "absent" });
  });

  windowsIt("round-trips a written state through read", () => {
    const paths = resolveUpdateStateStorePaths(tempDataRoot());
    const data = sampleState();
    writeUpdateState(paths, scriptPath, data);
    expect(readUpdateState(paths, scriptPath)).toEqual({ kind: "ok", data });
  });

  windowsIt("detects a hand-edited state file as corrupted", () => {
    const paths = resolveUpdateStateStorePaths(tempDataRoot());
    writeUpdateState(paths, scriptPath, sampleState());
    const raw = JSON.parse(readFileSync(paths.dataFile, "utf8"));
    raw.state.stage = "Complete";
    writeFileSync(paths.dataFile, JSON.stringify(raw));
    expect(readUpdateState(paths, scriptPath)).toEqual({ kind: "corrupted" });
  });

  windowsIt("uses an independent key from license-state.key (different key file)", () => {
    const paths = resolveUpdateStateStorePaths(tempDataRoot());
    writeUpdateState(paths, scriptPath, sampleState());
    expect(paths.keyFile.endsWith("update-state.key")).toBe(true);
    expect(paths.keyFile.endsWith("license-state.key")).toBe(false);
  });

  windowsIt("resetUpdateState clears both files so a fresh state can be generated", () => {
    const paths = resolveUpdateStateStorePaths(tempDataRoot());
    writeUpdateState(paths, scriptPath, sampleState());
    resetUpdateState(paths);
    expect(readUpdateState(paths, scriptPath)).toEqual({ kind: "absent" });
  });

  windowsIt("updates written state on a second write using the same key", () => {
    const paths = resolveUpdateStateStorePaths(tempDataRoot());
    const first = sampleState();
    writeUpdateState(paths, scriptPath, first);
    const second = {
      ...first,
      stage: "PayloadStaged" as const,
      updatedAt: "2026-01-02T00:00:00.000Z",
    };
    writeUpdateState(paths, scriptPath, second);
    expect(readUpdateState(paths, scriptPath)).toEqual({ kind: "ok", data: second });
  });
});
