import { spawnSync } from "node:child_process";
import path from "node:path";

/**
 * INST-11: the setup-grace anchor also lives in the machine registry, outside the data folder,
 * because "uninstall and remove data" deletes license-state.json and its key -- without this a
 * reinstall looked brand new and received a fresh 14-day grace. The uninstaller never removes
 * this key. Values are keyed by the data root, so a separate installation (the install drill)
 * keeps its own anchor. Defence in depth only: an administrator editing the registry can still
 * remove it, which is documented in docs/operations/software-licensing.md.
 */
export type InstallAnchorStore = {
  read(dataRoot: string): Date | null;
  /** Records the anchor only when none is recorded yet; never overwrites. */
  recordIfAbsent(dataRoot: string, anchor: Date): void;
};

const REGISTRY_KEY = String.raw`HKLM\SOFTWARE\HamdFoodsERP\LicenseGraceAnchor`;

function valueName(dataRoot: string) {
  return path.resolve(dataRoot).toLowerCase();
}

function reg(args: readonly string[]) {
  return spawnSync("reg.exe", [...args, "/reg:64"], {
    encoding: "utf8",
    windowsHide: true,
    timeout: 15_000,
  });
}

/** A registry-backed store under `key`; production uses the machine-wide HKLM key. */
export function createRegistryInstallAnchorStore(key: string): InstallAnchorStore {
  const read = (dataRoot: string) => {
    if (process.platform !== "win32") return null;
    try {
      const result = reg(["query", key, "/v", valueName(dataRoot)]);
      if (result.status !== 0) return null;
      const match = /REG_SZ\s+(\S+)\s*$/m.exec(result.stdout);
      const parsed = match ? new Date(match[1]!) : null;
      return parsed && !Number.isNaN(parsed.getTime()) ? parsed : null;
    } catch {
      return null;
    }
  };
  return {
    read,
    recordIfAbsent(dataRoot, anchor) {
      if (process.platform !== "win32" || read(dataRoot)) return;
      try {
        reg([
          "add",
          key,
          "/v",
          valueName(dataRoot),
          "/t",
          "REG_SZ",
          "/d",
          anchor.toISOString(),
          "/f",
        ]);
      } catch {
        // Best effort: the data-folder state still governs while it exists.
      }
    },
  };
}

export const registryInstallAnchorStore = createRegistryInstallAnchorStore(REGISTRY_KEY);
