import { existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { spawnSync } from "node:child_process";

import {
  PHASE27_TEST_DATABASE_URL,
  phase27TestDatabaseUrl,
  phase27TestEnvironment,
} from "../src/test/test-environment";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dataRoot = path.join(repositoryRoot, ".test-data");
const clusterDirectory = path.join(dataRoot, "postgresql-16");
const logPath = path.join(dataRoot, "postgresql-16.log");
const testPort = "55433";
const testHost = "127.0.0.1";
const testDatabase = "factory_erp_test";

type Action = "start" | "stop" | "migrate" | "reset" | "seed" | "integration" | "e2e" | "serve";

const action = process.argv[2] as Action | undefined;
if (!action) throw new Error("A test-database action is required.");

const environment = phase27TestEnvironment();
const managedUrl = phase27TestDatabaseUrl();
if (managedUrl !== PHASE27_TEST_DATABASE_URL)
  throw new Error(
    "The local lifecycle commands manage only the fixed Phase 27 test cluster. Remove the custom TEST_DATABASE_URL or manage that disposable database explicitly.",
  );

const postgresBin = locatePostgresBin();

switch (action) {
  case "start":
    startCluster();
    break;
  case "stop":
    stopCluster();
    break;
  case "migrate":
    startCluster();
    migrate();
    break;
  case "reset":
    resetAndSeed();
    break;
  case "seed":
    startCluster();
    seed();
    break;
  case "integration":
    resetAndSeed();
    runPackage(
      ["exec", "vitest", "run", "--config", "vitest.integration.config.ts"],
      withoutDatabaseUrl(environment),
    );
    break;
  case "e2e":
    resetAndSeed();
    runPackage(["exec", "tsx", "--conditions=react-server", "scripts/seed-e2e-workflow.ts"]);
    runPackage(["exec", "playwright", "test"]);
    break;
  case "serve":
    startCluster();
    runPackage(["exec", "next", "dev", "-p", "3417"]);
    break;
  default:
    throw new Error(`Unknown test-database action: ${String(action)}`);
}

function locatePostgresBin() {
  const candidates = [
    process.env.POSTGRES_BIN,
    ...[18, 17, 16, 15, 14].map((version) =>
      path.join(
        process.env.ProgramFiles ?? "C:\\Program Files",
        "PostgreSQL",
        String(version),
        "bin",
      ),
    ),
  ].filter((candidate): candidate is string => Boolean(candidate));
  const found = candidates.find((candidate) =>
    existsSync(path.join(candidate, executable("pg_ctl"))),
  );
  if (!found)
    throw new Error(
      "PostgreSQL server binaries were not found. Set POSTGRES_BIN to a test-capable PostgreSQL bin directory.",
    );
  return found;
}

function executable(name: string) {
  return process.platform === "win32" ? `${name}.exe` : name;
}

function postgresCommand(name: string) {
  return path.join(postgresBin, executable(name));
}

function command(
  command: string,
  args: readonly string[],
  options: { env?: NodeJS.ProcessEnv; quiet?: boolean } = {},
) {
  const result = spawnSync(command, [...args], {
    cwd: repositoryRoot,
    env: options.env ?? environment,
    encoding: "utf8",
    stdio: options.quiet ? "pipe" : "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(
      `${path.basename(command)} ${args.join(" ")} failed with exit code ${result.status ?? "unknown"}.`,
    );
  return result.stdout?.trim() ?? "";
}

function isReady() {
  const result = spawnSync(
    postgresCommand("pg_isready"),
    ["--host", testHost, "--port", testPort, "--dbname", "postgres"],
    { cwd: repositoryRoot, env: environment, stdio: "ignore" },
  );
  return result.status === 0;
}

function startCluster() {
  mkdirSync(dataRoot, { recursive: true });
  if (!existsSync(path.join(clusterDirectory, "PG_VERSION"))) {
    command(postgresCommand("initdb"), [
      "--pgdata",
      clusterDirectory,
      "--username",
      "postgres",
      "--auth-local",
      "trust",
      "--auth-host",
      "trust",
      "--encoding",
      "UTF8",
      "--no-locale",
    ]);
  }
  if (!isReady())
    command(postgresCommand("pg_ctl"), [
      "--pgdata",
      clusterDirectory,
      "--log",
      logPath,
      "--options",
      `-h ${testHost} -p ${testPort}`,
      "start",
      "--wait",
    ]);
  assertManagedCluster();
  const exists = command(
    postgresCommand("psql"),
    [
      "--host",
      testHost,
      "--port",
      testPort,
      "--username",
      "postgres",
      "--dbname",
      "postgres",
      "--tuples-only",
      "--no-align",
      "--command",
      `SELECT 1 FROM pg_database WHERE datname = '${testDatabase}'`,
    ],
    { quiet: true },
  );
  if (exists !== "1") createDatabase();
  console.log(`Disposable PostgreSQL ready at ${testHost}:${testPort}/${testDatabase}.`);
}

function assertManagedCluster() {
  const reportedDirectory = command(
    postgresCommand("psql"),
    [
      "--host",
      testHost,
      "--port",
      testPort,
      "--username",
      "postgres",
      "--dbname",
      "postgres",
      "--tuples-only",
      "--no-align",
      "--command",
      "SHOW data_directory",
    ],
    { quiet: true },
  );
  const expected = path.resolve(clusterDirectory).toLocaleLowerCase();
  const actual = path.resolve(reportedDirectory).toLocaleLowerCase();
  if (actual !== expected)
    throw new Error(
      `Port ${testPort} belongs to an unmanaged PostgreSQL cluster at ${reportedDirectory}; refusing all test-database mutations.`,
    );
}

function stopCluster() {
  if (!existsSync(path.join(clusterDirectory, "PG_VERSION")) || !isReady()) {
    console.log("Disposable PostgreSQL is already stopped.");
    return;
  }
  assertManagedCluster();
  command(postgresCommand("pg_ctl"), [
    "--pgdata",
    clusterDirectory,
    "stop",
    "--mode",
    "fast",
    "--wait",
  ]);
}

function createDatabase() {
  command(postgresCommand("createdb"), [
    "--host",
    testHost,
    "--port",
    testPort,
    "--username",
    "postgres",
    testDatabase,
  ]);
}

function resetDatabase() {
  startCluster();
  command(postgresCommand("dropdb"), [
    "--host",
    testHost,
    "--port",
    testPort,
    "--username",
    "postgres",
    "--if-exists",
    "--force",
    testDatabase,
  ]);
  createDatabase();
}

function migrate() {
  runPackage(["exec", "prisma", "migrate", "deploy"]);
}

function seed() {
  runPackage(["exec", "tsx", "--conditions=react-server", "scripts/seed-test-fixtures.ts"]);
}

function resetAndSeed() {
  resetDatabase();
  migrate();
  seed();
}

function runPackage(args: readonly string[], childEnvironment: NodeJS.ProcessEnv = environment) {
  const pnpmCli = process.env.npm_execpath;
  if (!pnpmCli)
    throw new Error("The test lifecycle must be launched through pnpm so its CLI is explicit.");
  command(process.execPath, [pnpmCli, ...args], { env: childEnvironment });
}

function withoutDatabaseUrl(source: NodeJS.ProcessEnv) {
  const childEnvironment = { ...source };
  delete childEnvironment.DATABASE_URL;
  return childEnvironment;
}
