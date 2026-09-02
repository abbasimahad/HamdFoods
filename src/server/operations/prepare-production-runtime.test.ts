import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { prepareProductionRuntime } from "../../../scripts/prepare-production-runtime";

const temporaryRoots: string[] = [];

describe("prepareProductionRuntime", () => {
  afterEach(() => {
    for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  it("rejects a standalone runtime with missing critical dependencies", () => {
    // Defect caught: a build could be declared ready even though Next would fail to resolve React at startup.
    const root = createRuntimeFixture(["next", "react"]);

    expect(() => prepareProductionRuntime(root)).toThrowError(/react-dom/);
  });

  it("accepts critical dependencies that resolve inside the standalone runtime", () => {
    const root = createRuntimeFixture(["next", "react", "react-dom"]);

    expect(() => prepareProductionRuntime(root)).not.toThrow();
  });

  it("rejects a critical dependency link that resolves outside the standalone runtime", () => {
    // Defect caught: a copied dependency link could appear present but fail when the runtime is moved to the server.
    const root = createRuntimeFixture(["next", "react-dom"]);
    const externalRoot = mkdtempSync(path.join(tmpdir(), "factory-external-dependency-"));
    temporaryRoots.push(externalRoot);
    createPackage(externalRoot, "react");
    symlinkSync(
      path.join(externalRoot, "node_modules", "react"),
      path.join(root, ".next", "standalone", "node_modules", "react"),
      "junction",
    );

    expect(() => prepareProductionRuntime(root)).toThrowError(/outside.*react|react.*outside/);
  });
});

function createRuntimeFixture(dependencies: string[]) {
  const root = mkdtempSync(path.join(tmpdir(), "factory-production-runtime-"));
  temporaryRoots.push(root);
  mkdirSync(path.join(root, ".next", "standalone", "node_modules"), { recursive: true });
  mkdirSync(path.join(root, ".next", "static"), { recursive: true });
  mkdirSync(path.join(root, "public"), { recursive: true });
  writeFileSync(path.join(root, ".next", "standalone", "server.js"), "");

  for (const dependency of dependencies) {
    createPackage(path.join(root, ".next", "standalone"), dependency);
  }

  return root;
}

function createPackage(nodeModulesParent: string, dependency: string) {
  const dependencyRoot = path.join(nodeModulesParent, "node_modules", dependency);
  mkdirSync(dependencyRoot, { recursive: true });
  writeFileSync(
    path.join(dependencyRoot, "package.json"),
    `${JSON.stringify({ name: dependency, version: "1.0.0" })}\n`,
  );
}
