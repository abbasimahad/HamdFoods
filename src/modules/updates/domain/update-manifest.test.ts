import { describe, expect, it } from "vitest";

import {
  canonicalizeUpdateManifest,
  findManifestPathIssues,
  isSafeManifestPath,
  parseUpdateManifest,
  UpdateManifestError,
  type UpdateManifest,
} from "./update-manifest";

function manifest(overrides: Partial<UpdateManifest> = {}): UpdateManifest {
  return {
    manifestVersion: 1,
    keyId: "update-vendor-1",
    fromVersion: "0.1.0",
    toVersion: "0.2.0",
    minimumInstallerSchemaVersion: 1,
    nodeRuntimeIncluded: false,
    requiredNodeVersion: "24.11.1",
    previousVersionCompatibleWithNewSchema: true,
    issuedAt: "2026-01-01T00:00:00.000Z",
    releaseNotesSummary: "Test release",
    files: [
      { path: "payload/app/server.js", sha256: "a".repeat(64), size: 10 },
      { path: "payload/manifest-note.txt", sha256: "b".repeat(64), size: 5 },
    ],
    ...overrides,
  };
}

describe("isSafeManifestPath", () => {
  it("accepts a normal payload-relative path", () => {
    expect(isSafeManifestPath("payload/app/server.js")).toBe(true);
  });

  it("rejects an absolute Windows path", () => {
    expect(isSafeManifestPath("C:/Windows/System32/evil.dll")).toBe(false);
    expect(isSafeManifestPath("C:\\Windows\\System32\\evil.dll")).toBe(false);
  });

  it("rejects a UNC path", () => {
    expect(isSafeManifestPath("\\\\server\\share\\file")).toBe(false);
  });

  it("rejects a leading slash", () => {
    expect(isSafeManifestPath("/etc/passwd")).toBe(false);
  });

  it("rejects directory traversal", () => {
    expect(isSafeManifestPath("payload/../../../Windows/System32/evil.dll")).toBe(false);
    expect(isSafeManifestPath("payload/app/../../outside.txt")).toBe(false);
  });

  it("rejects a path not rooted at payload/", () => {
    expect(isSafeManifestPath("app/server.js")).toBe(false);
    expect(isSafeManifestPath("bootstrap/windows/evil.ps1")).toBe(false);
  });

  it("rejects an empty path segment", () => {
    expect(isSafeManifestPath("payload//app/server.js")).toBe(false);
  });
});

describe("findManifestPathIssues", () => {
  it("finds no issues for a clean file list", () => {
    expect(findManifestPathIssues(manifest().files)).toEqual([]);
  });

  it("flags an unsafe path", () => {
    const issues = findManifestPathIssues([{ path: "../evil.js" }]);
    expect(issues.length).toBeGreaterThan(0);
  });

  it("flags case-colliding duplicate paths", () => {
    const issues = findManifestPathIssues([
      { path: "payload/app/Server.js" },
      { path: "payload/app/server.js" },
    ]);
    expect(issues.some((issue) => issue.includes("case-colliding"))).toBe(true);
  });

  it("flags an exact duplicate path", () => {
    const issues = findManifestPathIssues([
      { path: "payload/app/server.js" },
      { path: "payload/app/server.js" },
    ]);
    expect(issues.some((issue) => issue.includes("duplicate"))).toBe(true);
  });
});

describe("parseUpdateManifest", () => {
  it("accepts a well-formed manifest", () => {
    expect(parseUpdateManifest(manifest())).toEqual(manifest());
  });

  it("rejects fromVersion equal to toVersion", () => {
    expect(() => parseUpdateManifest(manifest({ toVersion: "0.1.0" }))).toThrow(
      UpdateManifestError,
    );
  });

  it("rejects a manifest containing an unsafe file path", () => {
    expect(() =>
      parseUpdateManifest(
        manifest({ files: [{ path: "../evil.js", sha256: "a".repeat(64), size: 1 }] }),
      ),
    ).toThrow(UpdateManifestError);
  });

  it("rejects a malformed version string", () => {
    expect(() => parseUpdateManifest(manifest({ toVersion: "0.2" }))).toThrow();
  });

  it("rejects extra unexpected top-level fields", () => {
    expect(() => parseUpdateManifest({ ...manifest(), extra: true })).toThrow();
  });

  it("rejects an empty files array", () => {
    expect(() => parseUpdateManifest(manifest({ files: [] }))).toThrow();
  });
});

describe("canonicalizeUpdateManifest", () => {
  it("produces a fixed field order and sorts files by path", () => {
    const a = manifest();
    const reorderedFiles = manifest({ files: [...a.files].reverse() });
    expect(canonicalizeUpdateManifest(a)).toBe(canonicalizeUpdateManifest(reorderedFiles));
  });

  it("changes when any field changes", () => {
    const base = canonicalizeUpdateManifest(manifest());
    const changed = canonicalizeUpdateManifest(manifest({ toVersion: "0.3.0" }));
    expect(changed).not.toBe(base);
  });

  it("changes when previousVersionCompatibleWithNewSchema changes", () => {
    const base = canonicalizeUpdateManifest(
      manifest({ previousVersionCompatibleWithNewSchema: true }),
    );
    const changed = canonicalizeUpdateManifest(
      manifest({ previousVersionCompatibleWithNewSchema: false }),
    );
    expect(changed).not.toBe(base);
  });
});
