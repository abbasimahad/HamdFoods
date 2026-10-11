import { spawnSync } from "node:child_process";

import { afterEach, describe, expect } from "vitest";
import { windowsIt } from "@/test/live-windows";

import { createRegistryInstallAnchorStore } from "./install-anchor";

// A throwaway per-user key: same reg.exe read/write path as the machine key, no admin needed.
const testRoot = String.raw`HKCU\Software\HamdFoodsERP-Test`;
const testKey = String.raw`${testRoot}\InstallAnchor-${process.pid}`;

afterEach(() => {
  spawnSync("reg.exe", ["delete", testRoot, "/f", "/reg:64"], { windowsHide: true });
});

describe("registry install anchor (INST-11, live Windows)", () => {
  windowsIt("records the anchor once and reads it back for the same data root", () => {
    const store = createRegistryInstallAnchorStore(testKey);
    const dataRoot = String.raw`C:\ProgramData\HamdFoodsERP`;
    expect(store.read(dataRoot)).toBeNull();
    store.recordIfAbsent(dataRoot, new Date("2026-10-01T00:00:00.000Z"));
    store.recordIfAbsent(dataRoot, new Date("2026-10-09T00:00:00.000Z"));
    expect(store.read(dataRoot)?.toISOString()).toBe("2026-10-01T00:00:00.000Z");
    // The same folder written differently is the same installation.
    expect(store.read("c:\\programdata\\hamdfoodserp\\")?.toISOString()).toBe(
      "2026-10-01T00:00:00.000Z",
    );
    // A separate installation (the install drill) keeps its own anchor.
    expect(store.read(String.raw`C:\ProgramData\HamdFoodsERP-InstallDrill`)).toBeNull();
  });
});
