import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { prisma } from "../db/prisma";

const enabled = process.platform === "win32" && process.env.HAMDFOODS_INSTALLER_DB_TEST === "1";
const installedIt = enabled ? it : it.skip;
const payloadRoot = path.resolve(".installer-work/payload");
const bundledNode = path.join(payloadRoot, "runtime", "node", "node.exe");
const operationsRoot = path.join(payloadRoot, "operations");

function runEntry(entry: string, extraEnvironment: Record<string, string | undefined> = {}) {
  const result = spawnSync(
    bundledNode,
    ["--conditions=react-server", path.join(operationsRoot, entry)],
    {
      cwd: operationsRoot,
      env: { ...process.env, ...extraEnvironment },
      encoding: "utf8",
      windowsHide: true,
    },
  );
  expect(result.status, result.stderr).toBe(0);
}

describe("installed payload against disposable PostgreSQL", () => {
  installedIt(
    "seeds and bootstraps idempotently without repository runtime dependencies",
    async () => {
      expect(existsSync(bundledNode)).toBe(true);
      runEntry("seed-all.mjs");
      const first = {
        roles: await prisma.role.count(),
        units: await prisma.unit.count(),
        categories: await prisma.itemCategory.count(),
      };
      runEntry("seed-all.mjs");
      expect({
        roles: await prisma.role.count(),
        units: await prisma.unit.count(),
        categories: await prisma.itemCategory.count(),
      }).toEqual(first);

      const email = "installed-payload-admin@example.invalid";
      const bootstrapEnvironment = {
        BOOTSTRAP_ADMIN_NAME: "Installed Payload Admin",
        BOOTSTRAP_ADMIN_EMAIL: email,
        BOOTSTRAP_ADMIN_PASSWORD: "installed-payload-password",
      };
      runEntry("bootstrap-super-admin.mjs", bootstrapEnvironment);
      runEntry("bootstrap-super-admin.mjs", bootstrapEnvironment);
      expect(await prisma.user.count({ where: { email } })).toBe(1);
      expect(
        await prisma.userRole.count({
          where: { user: { email }, role: { code: "SUPER_ADMIN" } },
        }),
      ).toBe(1);
    },
  );
});
