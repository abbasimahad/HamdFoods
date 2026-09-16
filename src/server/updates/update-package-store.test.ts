import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  derivePackageId,
  removeUpdatePackage,
  resolveUpdatePackagePath,
  resolveUpdatePackagePaths,
  storeUpdatePackage,
} from "./update-package-store";

let tempDirectories: string[] = [];
function tempDataRoot() {
  const dir = mkdtempSync(path.join(os.tmpdir(), "hamdfoods-update-pkg-store-"));
  tempDirectories.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of tempDirectories) rmSync(dir, { recursive: true, force: true });
  tempDirectories = [];
});

describe("derivePackageId", () => {
  it("is deterministic for the same manifest+signature", () => {
    const a = derivePackageId("{}", "sig");
    const b = derivePackageId("{}", "sig");
    expect(a).toBe(b);
  });

  it("differs for different content", () => {
    const a = derivePackageId("{}", "sig1");
    const b = derivePackageId("{}", "sig2");
    expect(a).not.toBe(b);
  });

  it("produces a safe, opaque identifier (no path characters)", () => {
    const id = derivePackageId('{"a":"../../evil"}', "sig");
    expect(id).toMatch(/^[a-f0-9]{32}$/);
  });
});

describe("resolveUpdatePackagePaths / storeUpdatePackage / resolveUpdatePackagePath", () => {
  it("stores a package and resolves its path by id", () => {
    const paths = resolveUpdatePackagePaths(tempDataRoot());
    const id = derivePackageId("{}", "sig");
    const destination = storeUpdatePackage(paths, id, Buffer.from("zip-bytes"));
    expect(destination).toBe(resolveUpdatePackagePath(paths, id));
    expect(destination.endsWith(`${id}.hfupdate`)).toBe(true);
  });

  it("removeUpdatePackage deletes a stored package without throwing if already absent", () => {
    const paths = resolveUpdatePackagePaths(tempDataRoot());
    const id = derivePackageId("{}", "sig");
    storeUpdatePackage(paths, id, Buffer.from("zip-bytes"));
    removeUpdatePackage(paths, id);
    expect(() => removeUpdatePackage(paths, id)).not.toThrow();
  });

  it("resolvePendingUpdateFile path lives alongside the updates directory", () => {
    const dataRoot = tempDataRoot();
    const paths = resolveUpdatePackagePaths(dataRoot);
    expect(paths.pendingUpdateFile).toBe(path.join(dataRoot, "state", "pending-update.json"));
    expect(paths.updatesDirectory).toBe(path.join(dataRoot, "state", "updates"));
  });

  it("does not confuse packages with different ids stored in the same directory", () => {
    const paths = resolveUpdatePackagePaths(tempDataRoot());
    const idA = derivePackageId("{}", "sig-a");
    const idB = derivePackageId("{}", "sig-b");
    storeUpdatePackage(paths, idA, Buffer.from("bytes-a"));
    storeUpdatePackage(paths, idB, Buffer.from("bytes-b"));
    writeFileSync(resolveUpdatePackagePath(paths, idA), Buffer.from("bytes-a-confirmed"));
    expect(resolveUpdatePackagePath(paths, idA)).not.toBe(resolveUpdatePackagePath(paths, idB));
  });
});
