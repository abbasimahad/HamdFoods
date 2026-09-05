import path from "node:path";

import { describe, expect, it } from "vitest";

import { discoverInnoSetupCompiler, type InnoSetupDiscoveryInput } from "./windows-installer";

const roots = {
  programFiles: "C:\\Program Files",
  programFilesX86: "C:\\Program Files (x86)",
  localAppData: "C:\\Users\\operator\\AppData\\Local",
};

function discoveryInput(
  existing: readonly string[],
  overrides: Partial<InnoSetupDiscoveryInput> = {},
): InnoSetupDiscoveryInput {
  const normalized = new Set(existing.map((candidate) => path.win32.normalize(candidate)));
  return {
    ...roots,
    isFile: (candidate) => normalized.has(path.win32.normalize(candidate)),
    execute: () => ({ status: 0, stdout: "7.1.0\n", stderr: "" }),
    ...overrides,
  };
}

describe("Inno Setup compiler discovery", () => {
  it.each([
    ["Program Files", "C:\\Program Files\\Inno Setup 7\\ISCC.exe"],
    ["Program Files (x86)", "C:\\Program Files (x86)\\Inno Setup 7\\ISCC.exe"],
    [
      "LOCALAPPDATA per-user Programs",
      "C:\\Users\\operator\\AppData\\Local\\Programs\\Inno Setup 7\\ISCC.exe",
    ],
  ])("detects a valid official %s installation", (_label, compilerPath) => {
    // Defect caught: a supported standalone location can exist but remain undiscoverable.
    expect(discoverInnoSetupCompiler(discoveryInput([compilerPath]))).toEqual({
      path: compilerPath,
      version: "7.1.0",
    });
  });

  it("derives the per-user path from LOCALAPPDATA and never selects an IDE node_modules copy", () => {
    // Defect caught: discovery could hardcode one username or recursively accept an unrelated bundled compiler.
    const localAppData = "C:\\Users\\factory-operator\\AppData\\Local";
    const official = `${localAppData}\\Programs\\Inno Setup 7\\ISCC.exe`;
    const unrelated = `${localAppData}\\Programs\\Antigravity IDE\\resources\\app\\node_modules\\innosetup\\bin\\ISCC.exe`;
    expect(
      discoverInnoSetupCompiler(
        discoveryInput([official, unrelated], {
          localAppData,
        }),
      ),
    ).toEqual({ path: official, version: "7.1.0" });
  });

  it("returns unavailable when no trusted candidate exists", () => {
    // Defect caught: an arbitrary filesystem or PATH hit could be treated as an official compiler.
    expect(discoverInnoSetupCompiler(discoveryInput([]))).toBeUndefined();
  });

  it("rejects a non-executable candidate and continues in deterministic trusted order", () => {
    // Defect caught: the first file named ISCC.exe could win without successfully identifying as Inno Setup 7.
    const machine = "C:\\Program Files\\Inno Setup 7\\ISCC.exe";
    const perUser = `${roots.localAppData}\\Programs\\Inno Setup 7\\ISCC.exe`;
    const executed: string[] = [];
    expect(
      discoverInnoSetupCompiler(
        discoveryInput([machine, perUser], {
          execute(candidate) {
            executed.push(candidate);
            return candidate === machine
              ? { status: 1, stdout: "", stderr: "not executable" }
              : { status: 0, stdout: "7.2.0", stderr: "" };
          },
        }),
      ),
    ).toEqual({ path: perUser, version: "7.2.0" });
    expect(executed).toEqual([machine, perUser]);
  });

  it("rejects a candidate whose process cannot be launched", () => {
    // Defect caught: spawn errors must reject the candidate instead of aborting trusted fallback discovery.
    const machine = "C:\\Program Files\\Inno Setup 7\\ISCC.exe";
    const perUser = `${roots.localAppData}\\Programs\\Inno Setup 7\\ISCC.exe`;
    expect(
      discoverInnoSetupCompiler(
        discoveryInput([machine, perUser], {
          execute(candidate) {
            if (candidate === machine) throw new Error("access denied");
            return { status: 0, stdout: "7.1.0", stderr: "" };
          },
        }),
      ),
    ).toEqual({ path: perUser, version: "7.1.0" });
  });

  it("prefers a validated explicit override and fails closed when that override is invalid", () => {
    // Defect caught: an invalid override could be silently ignored or lose precedence to an implicit location.
    const override = "D:\\Trusted Tools\\Inno Setup 7\\ISCC.exe";
    const machine = "C:\\Program Files\\Inno Setup 7\\ISCC.exe";
    expect(
      discoverInnoSetupCompiler(
        discoveryInput([override, machine], {
          configuredPath: override,
        }),
      ),
    ).toEqual({ path: override, version: "7.1.0" });
    expect(() =>
      discoverInnoSetupCompiler(
        discoveryInput([machine], {
          configuredPath: "relative\\ISCC.exe",
        }),
      ),
    ).toThrowError(/explicit compiler override/i);
  });
});
