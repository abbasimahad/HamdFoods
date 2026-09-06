import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const enabled =
  process.platform === "win32" && process.env.HAMDFOODS_INSTALLER_PAYLOAD_TEST === "1";
const installedIt = enabled ? it : it.skip;
const payloadRoot = path.resolve(".installer-work/payload");
const bundledNode = path.join(payloadRoot, "runtime", "node", "node.exe");
const operationsRoot = path.join(payloadRoot, "operations");

function runInstalled(args: string[], environment: Record<string, string | undefined> = {}) {
  const startedAt = Date.now();
  const result = spawnSync(bundledNode, args, {
    cwd: operationsRoot,
    env: { ...process.env, ...environment },
    encoding: "utf8",
    windowsHide: true,
    timeout: 15_000,
  });
  return { ...result, elapsedMs: Date.now() - startedAt };
}

describe("prepared installer payload executable boundaries", () => {
  installedIt(
    "loads migration, seed, bootstrap, and production dependency entrypoints",
    () => {
      expect(existsSync(bundledNode)).toBe(true);
      const unavailableDatabase =
        "postgresql://payload_test:payload_test@127.0.0.1:1/installer_payload_test?connect_timeout=2";
      const boundaries: Array<{ args: string[]; databaseError: RegExp }> = [
        {
          args: [
            path.join(operationsRoot, "node_modules", "prisma", "build", "index.js"),
            "migrate",
            "deploy",
            "--config",
            path.join(operationsRoot, "prisma.config.mjs"),
          ],
          databaseError: /Schema engine error|P1001|Can't reach database server/i,
        },
        {
          args: ["--conditions=react-server", path.join(operationsRoot, "seed-all.mjs")],
          databaseError: /P1001|Can't reach database server/i,
        },
        {
          args: [
            "--conditions=react-server",
            path.join(operationsRoot, "bootstrap-super-admin.mjs"),
          ],
          databaseError: /P1001|Can't reach database server/i,
        },
      ];
      for (const boundary of boundaries) {
        const result = runInstalled(boundary.args, {
          APP_ENV: "production",
          DATABASE_URL: unavailableDatabase,
          BETTER_AUTH_SECRET: "a".repeat(64),
          BETTER_AUTH_URL: "http://127.0.0.1:3200",
          HOSTNAME: "127.0.0.1",
          PORT: "3200",
          BOOTSTRAP_ADMIN_NAME: "Payload Boundary",
          BOOTSTRAP_ADMIN_EMAIL: "payload-boundary@example.invalid",
          BOOTSTRAP_ADMIN_PASSWORD: "payload-boundary-password",
        });
        const diagnostic = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
        expect(result.error, result.error?.message).toBeUndefined();
        expect(result.signal).toBeNull();
        expect(result.status).not.toBeNull();
        expect(result.elapsedMs).toBeLessThan(12_000);
        expect(result.status).not.toBe(0);
        expect(diagnostic).toMatch(boundary.databaseError);
        expect(diagnostic).not.toMatch(/ERR_MODULE_NOT_FOUND|Cannot find package|Dynamic require/i);
        expect(diagnostic).not.toContain("payload-boundary-password");
      }

      const dependencyProbe = runInstalled([
        "--conditions=react-server",
        "--input-type=module",
        "--eval",
        "await Promise.all([import('@prisma/client/runtime/client'), import('@prisma/adapter-pg'), import('better-auth'), import('pg'), import('decimal.js'), import('zod')]); console.log('DEPENDENCIES_OK')",
      ]);
      expect(dependencyProbe.status, dependencyProbe.stderr).toBe(0);
      expect(dependencyProbe.stdout).toContain("DEPENDENCIES_OK");
    },
    60_000,
  );

  installedIt("contains no source maps, declarations, or package markdown", () => {
    const manifest = JSON.parse(
      readFileSync(path.join(payloadRoot, "installer-manifest.json"), "utf8"),
    ) as { developmentUnsigned?: boolean };
    expect(manifest.developmentUnsigned).toBe(true);
    const result = spawnSync(
      process.execPath,
      [
        "--input-type=module",
        "--eval",
        "import{readdirSync,statSync}from'node:fs';import path from'node:path';const r=process.argv[1],q=[r],bad=[];while(q.length){const d=q.pop();for(const n of readdirSync(d)){const p=path.join(d,n),s=statSync(p);if(s.isDirectory())q.push(p);else if(/(?:\\.map|\\.d\\.[cm]?ts|\\.md|\\.markdown)$/i.test(n))bad.push(path.relative(r,p))}}if(bad.length){console.error(bad.join('\\n'));process.exit(1)}",
        payloadRoot,
      ],
      { encoding: "utf8" },
    );
    expect(result.status, result.stderr).toBe(0);
  });
});
