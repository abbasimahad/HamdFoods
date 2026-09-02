import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { config } from "dotenv";
import { Client } from "pg";

import { parseServerEnv } from "../src/server/env";
import { resolvePostgresTool } from "../src/server/operations/database-backup";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const productionEnvPath = path.join(repositoryRoot, ".env.production");
const action = process.argv[2];

try {
  const environment = loadProductionEnvironment();

  switch (action) {
    case "build":
      runPackage(["exec", "prisma", "generate"], environment);
      runPackage(["exec", "next", "build"], environment);
      runPackage(["exec", "tsx", "scripts/prepare-production-runtime.ts"], environment);
      break;
    case "migrate":
      runPackage(["exec", "prisma", "migrate", "deploy"], environment);
      break;
    case "seed":
      runPackage(["exec", "tsx", "--conditions=react-server", "scripts/seed-all.ts"], environment);
      break;
    case "bootstrap":
      runPackage(
        ["exec", "tsx", "--conditions=react-server", "scripts/bootstrap-super-admin.ts"],
        environment,
      );
      break;
    case "backup":
      runPackage(
        [
          "exec",
          "tsx",
          "scripts/database-backup.ts",
          requireBackupAction(process.argv[3]),
          ...process.argv.slice(4),
        ],
        environment,
      );
      break;
    case "health":
      await checkHealth(environment);
      break;
    case "preflight":
      await preflight(environment);
      break;
    default:
      throw new Error(
        "Usage: production.ts <build|migrate|seed|bootstrap|backup|health|preflight>.",
      );
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : "Production command failed.");
  process.exitCode = 1;
}

function loadProductionEnvironment() {
  if (!existsSync(productionEnvPath))
    throw new Error(
      ".env.production is required. Copy .env.production.example and protect the real file.",
    );
  const result = config({ path: productionEnvPath, quiet: true, override: true });
  if (result.error) throw new Error(".env.production could not be loaded.");
  const serverEnv = parseServerEnv(process.env);
  return { ...process.env, ...serverEnv, NODE_ENV: "production" };
}

function runPackage(args: string[], environment: NodeJS.ProcessEnv) {
  const pnpmCli = process.env.npm_execpath;
  if (!pnpmCli) throw new Error("Production commands must be launched through pnpm.");
  const result = spawnSync(process.execPath, [pnpmCli, ...args], {
    cwd: repositoryRoot,
    env: environment,
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(`Production command failed with exit code ${result.status ?? "unknown"}.`);
}

function requireBackupAction(value: string | undefined) {
  if (value === "create" || value === "list" || value === "verify") return value;
  throw new Error("Backup usage: production.ts backup <create|list|verify> [backup-id].");
}

async function preflight(environment: NodeJS.ProcessEnv) {
  if (process.platform !== "win32")
    throw new Error("Native production hosting is supported only on Windows in Phase 30.");
  const nodeMajor = Number(process.versions.node.split(".")[0]);
  if (nodeMajor !== 24) throw new Error("Node.js 24 is required for native production hosting.");
  const hostname = environment.HOSTNAME;
  const port = Number(environment.PORT);
  if (!isLoopbackHost(hostname))
    throw new Error("HOSTNAME must be a loopback address in Phase 30.");
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535)
    throw new Error("PORT must be an integer between 1 and 65535.");

  for (const tool of ["pg_isready", "psql", "pg_dump", "pg_restore", "createdb", "dropdb"])
    resolvePostgresTool(tool);

  const client = new Client({ connectionString: environment.DATABASE_URL });
  try {
    await client.connect();
    const result = await client.query<{ version: string }>("SHOW server_version");
    console.log(`PostgreSQL reachable: ${result.rows[0]?.version ?? "unknown version"}.`);
  } finally {
    await client.end().catch(() => undefined);
  }
  console.log(`Native Windows preflight passed for ${hostname}:${port}.`);
}

async function checkHealth(environment: NodeJS.ProcessEnv) {
  const hostname = environment.HOSTNAME ?? "127.0.0.1";
  const port = environment.PORT ?? "3000";
  const response = await fetch(`http://${hostname}:${port}/api/health`);
  const body: unknown = await response.json().catch(() => undefined);
  if (response.status !== 200 || !isOkHealthResponse(body))
    throw new Error('Production health check failed: expected HTTP 200 with {status: "ok"}.');
  console.log("Production health check passed.");
}

function isOkHealthResponse(value: unknown): value is { status: "ok" } {
  return Boolean(value && typeof value === "object" && "status" in value && value.status === "ok");
}

function isLoopbackHost(value: string | undefined) {
  return value === "127.0.0.1" || value === "localhost" || value === "::1";
}
