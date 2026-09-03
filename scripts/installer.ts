import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statfsSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { build } from "esbuild";

import {
  classifyPort,
  classifyPostgresInstallation,
  PINNED_NODE_ARCHIVE,
  PINNED_NODE_SHA256,
  PINNED_NODE_VERSION,
  PRODUCTION_INSTALLER_OPTIONS,
  SUPPORTED_POSTGRES_MAJOR,
  validatePayloadFiles,
  type PostgresCandidate,
} from "../src/server/operations/windows-installer";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cacheRoot = path.join(repositoryRoot, ".installer-cache");
const workRoot = path.join(repositoryRoot, ".installer-work");
const payloadRoot = path.join(workRoot, "payload");
const outputRoot = path.join(repositoryRoot, "installer", "output");
const nodeArchivePath = path.join(cacheRoot, PINNED_NODE_ARCHIVE);
const nodeDownloadUrl = `https://nodejs.org/dist/v${PINNED_NODE_VERSION}/${PINNED_NODE_ARCHIVE}`;
const action = process.argv[2];

try {
  switch (action) {
    case "preflight":
      runPreflight();
      break;
    case "prepare":
      await preparePayload();
      break;
    case "verify":
      verifyPayload();
      break;
    case "build":
      await preparePayload();
      verifyPayload();
      compileInstaller(false);
      break;
    case "drill":
      await runDrill();
      break;
    default:
      throw new Error("Usage: installer.ts <preflight|prepare|verify|build|drill>.");
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : "Installer command failed.");
  process.exitCode = 1;
}

function runPreflight() {
  const windowsSupported = process.platform === "win32";
  const administrator = windowsSupported && isAdministrator();
  const architecture = process.arch;
  const diskFree = Number(statfsSync(repositoryRoot).bavail * statfsSync(repositoryRoot).bsize);
  const diskSpace = diskFree >= 2 * 1024 * 1024 * 1024;
  const nodePayload =
    existsSync(nodeArchivePath) && checksumFileSync(nodeArchivePath) === PINNED_NODE_SHA256;
  const postgres = classifyPostgresInstallation(discoverPostgresCandidates());
  const existingTask =
    windowsSupported && scheduledTaskExists(PRODUCTION_INSTALLER_OPTIONS.taskName);
  const listeners = windowsSupported ? getPortListeners(PRODUCTION_INSTALLER_OPTIONS.port) : [];
  const port = classifyPort(
    listeners.map((listener) => ({
      address: listener.address,
      owner: existingTask ? "HamdFoodsERP" : "OtherService",
    })),
  );
  const existingInstall = existsSync(PRODUCTION_INSTALLER_OPTIONS.appRoot);
  const tailscale = discoverTailscale();
  const compiler = discoverInnoCompiler();

  console.log(`Windows Supported: ${windowsSupported ? "PASS" : "FAIL"}`);
  console.log(`Administrator: ${administrator ? "PASS" : "FAIL"}`);
  console.log(`Architecture: ${architecture}`);
  console.log(`Disk Space: ${diskSpace ? "PASS" : "FAIL"}`);
  console.log(
    `Node Payload: ${nodePayload ? "PASS" : "MISSING (downloaded by installer:prepare)"}`,
  );
  console.log(
    `PostgreSQL: ${postgres.status === "installed" ? "INSTALLED" : postgres.status.toUpperCase()}`,
  );
  console.log(`PostgreSQL Tools: ${postgres.status === "installed" ? "PASS" : "FAIL"}`);
  console.log(`Port 3100: ${port.toUpperCase()}`);
  console.log(`Existing HamdFoodsERP: ${existingInstall ? "YES" : "NO"}`);
  console.log(`Existing Scheduled Task: ${existingTask ? "YES" : "NO"}`);
  console.log(`Tailscale: OPTIONAL ${tailscale ? "INSTALLED" : "NOT INSTALLED"}`);
  console.log(`Installer Compiler: ${compiler ? "PASS" : "FAIL"}`);

  if (!windowsSupported || !administrator || architecture !== "x64" || !diskSpace)
    throw new Error("Installer preflight failed a required host check.");
  if (postgres.status === "unsupported")
    throw new Error(
      `Unsupported/conflicting PostgreSQL major detected: ${postgres.detectedMajors.join(", ")}.`,
    );
  if (!compiler)
    throw new Error(
      "Inno Setup compiler is not available. Install current Inno Setup from https://jrsoftware.org/isdl.php and rerun installer:build.",
    );
}

async function preparePayload() {
  assertBuildHost();
  const standaloneRoot = path.join(repositoryRoot, ".next", "standalone");
  if (!existsSync(path.join(standaloneRoot, "server.js")))
    throw new Error(
      "Prepared Next standalone output is missing. Use the elevated maintenance window and run production:build first.",
    );

  resetOwnedBuildDirectory(workRoot);
  mkdirSync(payloadRoot, { recursive: true });
  await ensurePinnedNodeArchive();
  stageNodeRuntime();
  stageStandaloneRuntime(standaloneRoot);
  stageWindowsScripts();
  await stageOperationalBundles();
  stagePrismaMigrations();
  stagePrismaCli();
  stageOptionalPostgresPrerequisite();
  writePayloadMetadata();
  verifyPayload();
  console.log(`Installer payload prepared at ${payloadRoot}.`);
}

function verifyPayload() {
  if (!existsSync(payloadRoot))
    throw new Error("Installer payload is missing. Run installer:prepare.");
  const files = listRelativeFiles(payloadRoot);
  validatePayloadFiles(files);
  const metadata = JSON.parse(
    readFileSync(path.join(payloadRoot, "installer-manifest.json"), "utf8"),
  ) as {
    applicationVersion?: unknown;
    nodeVersion?: unknown;
    nodeSha256?: unknown;
    postgresMajor?: unknown;
  };
  const version = readApplicationVersion();
  if (
    metadata.applicationVersion !== version ||
    metadata.nodeVersion !== PINNED_NODE_VERSION ||
    metadata.nodeSha256 !== PINNED_NODE_SHA256 ||
    metadata.postgresMajor !== SUPPORTED_POSTGRES_MAJOR
  )
    throw new Error("Installer payload metadata does not match controlled version sources.");

  const bundledNode = path.join(payloadRoot, "runtime", "node", "node.exe");
  const nodeResult = run(bundledNode, ["--version"], payloadRoot);
  if (nodeResult.status !== 0 || nodeResult.stdout.trim() !== `v${PINNED_NODE_VERSION}`)
    throw new Error("Bundled Node runtime version verification failed.");

  const prismaCli = path.join(
    payloadRoot,
    "operations",
    "node_modules",
    "prisma",
    "build",
    "index.js",
  );
  const prismaResult = run(
    bundledNode,
    [prismaCli, "--config", path.join(payloadRoot, "operations", "prisma.config.mjs"), "--version"],
    path.join(payloadRoot, "operations"),
    {
      DATABASE_URL: "postgresql://verification:verification@127.0.0.1:5432/verification",
      PRISMA_HIDE_UPDATE_MESSAGE: "1",
    },
  );
  if (prismaResult.status !== 0 || !/prisma\s+:\s+7\.9\.1/.test(prismaResult.stdout))
    throw new Error("Bundled Prisma migration CLI verification failed.");

  for (const script of listRelativeFiles(path.join(payloadRoot, "windows"))) {
    const scriptPath = path.join(payloadRoot, "windows", script);
    const parser = run(
      systemPowerShell(),
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        `$errors = $null; [System.Management.Automation.Language.Parser]::ParseFile('${escapePowerShellLiteral(scriptPath)}', [ref]$null, [ref]$errors) | Out-Null; if ($errors.Count) { $errors | ForEach-Object Message; exit 1 }`,
      ],
      payloadRoot,
    );
    if (parser.status !== 0) throw new Error(`Installed PowerShell syntax failed: ${script}`);
  }
  console.log(`Installer payload verification passed (${files.length} files).`);
}

function compileInstaller(drill: boolean) {
  const compiler = discoverInnoCompiler();
  if (!compiler)
    throw new Error(
      "Inno Setup compiler is not available. Install current Inno Setup from https://jrsoftware.org/isdl.php; no compiler was downloaded automatically.",
    );
  mkdirSync(outputRoot, { recursive: true });
  const version = readApplicationVersion();
  const args = [
    `/DAppVersion=${version}`,
    `/DPayloadRoot=${payloadRoot}`,
    ...(!drill && process.env.HAMDFOODS_INSTALLER_PORT
      ? [`/DAppPort=${readProductionInstallerPort()}`]
      : []),
    ...(drill ? ["/DDrillBuild=1"] : []),
    path.join(repositoryRoot, "installer", "HamdFoodsERP.iss"),
  ];
  const signingName = process.env.HAMDFOODS_INNO_SIGNTOOL_NAME;
  if (signingName) {
    if (!/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(signingName))
      throw new Error(
        "HAMDFOODS_INNO_SIGNTOOL_NAME must be a preconfigured safe Inno SignTool name.",
      );
    args.unshift(`/DInstallerSignTool=${signingName}`);
  }
  const result = run(compiler, args, repositoryRoot);
  if (result.status !== 0) throw new Error("Inno Setup compilation failed.");
  console.log(
    `${drill ? "Isolated drill" : "Development / unsigned"} installer compiled in ${outputRoot}.`,
  );
}

function readProductionInstallerPort() {
  const port = Number(process.env.HAMDFOODS_INSTALLER_PORT);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535 || port === 5432)
    throw new Error("HAMDFOODS_INSTALLER_PORT must be a safe integer port other than 5432.");
  return port;
}

async function runDrill() {
  await preparePayload();
  verifyPayload();
  compileInstaller(true);
  if (process.env.HAMDFOODS_RUN_INSTALLER_DRILL !== "1")
    throw new Error(
      "Drill installer compiled but was not launched. Set HAMDFOODS_RUN_INSTALLER_DRILL=1 only during an approved isolated interactive drill.",
    );
  const installer = newestInstaller("InstallDrill");
  const result = spawnSync(installer, ["/DRILL=1"], {
    cwd: outputRoot,
    stdio: "inherit",
    windowsHide: false,
  });
  if (result.status !== 0)
    throw new Error("Isolated installer drill did not complete successfully.");
}

function assertBuildHost() {
  if (process.platform !== "win32" || process.arch !== "x64")
    throw new Error("Phase 32 packaging requires 64-bit Windows.");
  if (process.versions.node !== PINNED_NODE_VERSION)
    throw new Error(`Packaging must run on the tested Node ${PINNED_NODE_VERSION} runtime.`);
}

async function ensurePinnedNodeArchive() {
  mkdirSync(cacheRoot, { recursive: true });
  if (existsSync(nodeArchivePath)) {
    if (checksumFileSync(nodeArchivePath) === PINNED_NODE_SHA256) return;
    throw new Error(
      "Cached Node archive checksum is invalid; remove only that cache file and retry.",
    );
  }
  const response = await fetch(nodeDownloadUrl, { redirect: "error" });
  if (!response.ok)
    throw new Error(`Official Node archive download failed with HTTP ${response.status}.`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (createHash("sha256").update(bytes).digest("hex") !== PINNED_NODE_SHA256)
    throw new Error("Downloaded Node archive failed the pinned SHA-256 check.");
  writeFileSync(nodeArchivePath, bytes, { flag: "wx" });
}

function stageNodeRuntime() {
  const extractRoot = path.join(workRoot, "node-extract");
  mkdirSync(extractRoot, { recursive: true });
  const result = run(
    systemPowerShell(),
    [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      `Expand-Archive -LiteralPath '${escapePowerShellLiteral(nodeArchivePath)}' -DestinationPath '${escapePowerShellLiteral(extractRoot)}' -Force`,
    ],
    repositoryRoot,
  );
  if (result.status !== 0) throw new Error("Pinned Node archive extraction failed.");
  const extracted = path.join(extractRoot, `node-v${PINNED_NODE_VERSION}-win-x64`);
  const target = path.join(payloadRoot, "runtime", "node");
  mkdirSync(target, { recursive: true });
  cpSync(path.join(extracted, "node.exe"), path.join(target, "node.exe"));
  cpSync(path.join(extracted, "LICENSE"), path.join(target, "LICENSE.node.txt"));
}

function stageStandaloneRuntime(standaloneRoot: string) {
  cpSync(standaloneRoot, path.join(payloadRoot, "app"), {
    recursive: true,
    dereference: true,
    filter(source) {
      const name = path.basename(source).toLowerCase();
      return name !== ".env" && !name.startsWith(".env.");
    },
  });
}

function stageWindowsScripts() {
  const source = path.join(repositoryRoot, "installer", "scripts");
  if (!existsSync(source)) throw new Error("Installed Windows setup scripts are missing.");
  cpSync(source, path.join(payloadRoot, "windows"), { recursive: true });
}

async function stageOperationalBundles() {
  const operationsRoot = path.join(payloadRoot, "operations");
  mkdirSync(operationsRoot, { recursive: true });
  const entries = [
    ["scripts/seed-all.ts", "seed-all.mjs"],
    ["scripts/bootstrap-super-admin.ts", "bootstrap-super-admin.mjs"],
    ["scripts/database-backup.ts", "database-backup.mjs"],
  ] as const;
  for (const [entry, output] of entries)
    await build({
      entryPoints: [path.join(repositoryRoot, entry)],
      outfile: path.join(operationsRoot, output),
      bundle: true,
      platform: "node",
      format: "esm",
      target: "node24",
      conditions: ["react-server", "node", "import"],
      sourcemap: false,
      legalComments: "none",
      logLevel: "silent",
    });
}

function stagePrismaMigrations() {
  const prismaRoot = path.join(payloadRoot, "operations", "prisma");
  mkdirSync(prismaRoot, { recursive: true });
  cpSync(
    path.join(repositoryRoot, "prisma", "schema.prisma"),
    path.join(prismaRoot, "schema.prisma"),
  );
  cpSync(path.join(repositoryRoot, "prisma", "migrations"), path.join(prismaRoot, "migrations"), {
    recursive: true,
  });
  writeFileSync(
    path.join(payloadRoot, "operations", "prisma.config.mjs"),
    [
      'import { defineConfig, env } from "prisma/config";',
      "",
      "export default defineConfig({",
      '  schema: "prisma/schema.prisma",',
      '  migrations: { path: "prisma/migrations" },',
      '  datasource: { url: env("DATABASE_URL") },',
      "});",
      "",
    ].join("\n"),
  );
}

function stagePrismaCli() {
  const targetNodeModules = path.join(payloadRoot, "operations", "node_modules");
  mkdirSync(targetNodeModules, { recursive: true });
  const pending = ["prisma"];
  const copied = new Set<string>();
  while (pending.length) {
    const packageName = pending.pop()!;
    if (copied.has(packageName)) continue;
    const source = path.join(repositoryRoot, "node_modules", ...packageName.split("/"));
    const packageJsonPath = path.join(source, "package.json");
    if (!existsSync(packageJsonPath))
      throw new Error(`Installed dependency closure is missing ${packageName}.`);
    const destination = path.join(targetNodeModules, ...packageName.split("/"));
    mkdirSync(path.dirname(destination), { recursive: true });
    cpSync(source, destination, {
      recursive: true,
      dereference: true,
      filter(candidate) {
        const relative = path.relative(source, candidate).replaceAll("\\", "/").toLowerCase();
        if (!relative) return true;
        const segments = relative.split("/");
        return (
          !segments.some((segment) =>
            ["test", "tests", "__tests__", "fixtures", "examples"].includes(segment),
          ) &&
          !/\.(?:test|spec)\.[cm]?[jt]sx?$/.test(relative) &&
          !relative.endsWith(".map")
        );
      },
    });
    copied.add(packageName);
    const pkg = JSON.parse(readFileSync(packageJsonPath, "utf8")) as {
      dependencies?: Record<string, string>;
      optionalDependencies?: Record<string, string>;
    };
    for (const dependency of [
      ...Object.keys(pkg.dependencies ?? {}),
      ...Object.keys(pkg.optionalDependencies ?? {}),
    ])
      if (existsSync(path.join(repositoryRoot, "node_modules", ...dependency.split("/"))))
        pending.push(dependency);
  }
}

function stageOptionalPostgresPrerequisite() {
  const source = process.env.HAMDFOODS_POSTGRES_INSTALLER;
  if (!source) return;
  const expectedHash = process.env.HAMDFOODS_POSTGRES_INSTALLER_SHA256?.toLowerCase();
  if (!path.isAbsolute(source) || !existsSync(source) || !/^[a-f0-9]{64}$/.test(expectedHash ?? ""))
    throw new Error(
      "Optional PostgreSQL prerequisite requires an absolute installer path and a trusted SHA-256.",
    );
  if (checksumFileSync(source) !== expectedHash)
    throw new Error("Optional PostgreSQL prerequisite failed its trusted SHA-256 check.");
  const destination = path.join(payloadRoot, "prerequisites");
  mkdirSync(destination, { recursive: true });
  cpSync(source, path.join(destination, "postgresql-16-windows-x64.exe"));
}

function writePayloadMetadata() {
  const metadata = {
    product: "Hamd Foods ERP",
    applicationVersion: readApplicationVersion(),
    nodeVersion: PINNED_NODE_VERSION,
    nodeArchive: PINNED_NODE_ARCHIVE,
    nodeSha256: PINNED_NODE_SHA256,
    postgresMajor: SUPPORTED_POSTGRES_MAJOR,
    migrationCount: readdirSync(path.join(repositoryRoot, "prisma", "migrations"), {
      withFileTypes: true,
    }).filter((entry) => entry.isDirectory()).length,
    developmentUnsigned: !process.env.HAMDFOODS_INNO_SIGNTOOL_NAME,
  };
  writeFileSync(
    path.join(payloadRoot, "installer-manifest.json"),
    `${JSON.stringify(metadata, null, 2)}\n`,
  );
  writeFileSync(
    path.join(payloadRoot, "package.json"),
    `${JSON.stringify(
      {
        name: "hamd-foods-erp-installed",
        version: metadata.applicationVersion,
        private: true,
        type: "module",
      },
      null,
      2,
    )}\n`,
  );
}

function discoverPostgresCandidates(): PostgresCandidate[] {
  if (process.platform !== "win32") return [];
  const candidates: PostgresCandidate[] = [];
  for (const major of [18, 17, 16, 15, 14]) {
    const binPath = path.join(
      process.env.ProgramFiles ?? "C:\\Program Files",
      "PostgreSQL",
      String(major),
      "bin",
    );
    if (!existsSync(binPath)) continue;
    const serviceName = `postgresql-x64-${major}`;
    candidates.push({
      major,
      binPath,
      serviceName,
      serviceRunning: serviceIsRunning(serviceName),
      toolsPresent: ["psql.exe", "pg_isready.exe", "pg_dump.exe", "pg_restore.exe"].every((tool) =>
        existsSync(path.join(binPath, tool)),
      ),
    });
  }
  return candidates;
}

function discoverInnoCompiler() {
  const configured = process.env.INNO_SETUP_COMPILER;
  const candidates = [
    configured,
    path.join(process.env.ProgramFiles ?? "C:\\Program Files", "Inno Setup 7", "ISCC.exe"),
    path.join(process.env.ProgramFiles ?? "C:\\Program Files", "Inno Setup 6", "ISCC.exe"),
    path.join(
      process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)",
      "Inno Setup 6",
      "ISCC.exe",
    ),
  ].filter((candidate): candidate is string => Boolean(candidate));
  if (configured && (!path.isAbsolute(configured) || !existsSync(configured)))
    throw new Error("INNO_SETUP_COMPILER must identify an existing absolute ISCC.exe path.");
  return candidates.find(
    (candidate) => path.basename(candidate).toLowerCase() === "iscc.exe" && existsSync(candidate),
  );
}

function discoverTailscale() {
  return [
    path.join(process.env.ProgramFiles ?? "C:\\Program Files", "Tailscale", "tailscale.exe"),
    path.join(
      process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)",
      "Tailscale IPN",
      "tailscale.exe",
    ),
  ].some((candidate) => existsSync(candidate));
}

function isAdministrator() {
  const result = run(
    systemPowerShell(),
    [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      "if (([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { exit 0 } else { exit 1 }",
    ],
    repositoryRoot,
  );
  return result.status === 0;
}

function scheduledTaskExists(taskName: string) {
  const result = run(
    systemPowerShell(),
    [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      `if (Get-ScheduledTask -TaskName '${escapePowerShellLiteral(taskName)}' -ErrorAction SilentlyContinue) { exit 0 } else { exit 1 }`,
    ],
    repositoryRoot,
  );
  return result.status === 0;
}

function serviceIsRunning(serviceName: string) {
  const result = run(
    systemPowerShell(),
    [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      `if ((Get-Service -Name '${escapePowerShellLiteral(serviceName)}' -ErrorAction SilentlyContinue).Status -eq 'Running') { exit 0 } else { exit 1 }`,
    ],
    repositoryRoot,
  );
  return result.status === 0;
}

function getPortListeners(port: number) {
  const result = run(
    systemPowerShell(),
    [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      `@(Get-NetTCPConnection -State Listen -LocalPort ${port} -ErrorAction SilentlyContinue | Select-Object LocalAddress,OwningProcess) | ConvertTo-Json -Compress`,
    ],
    repositoryRoot,
  );
  if (result.status !== 0 || !result.stdout.trim()) return [];
  const parsed: unknown = JSON.parse(result.stdout);
  const values = Array.isArray(parsed) ? parsed : [parsed];
  return values.flatMap((value) => {
    if (!value || typeof value !== "object") return [];
    const candidate = value as Record<string, unknown>;
    return typeof candidate.LocalAddress === "string"
      ? [{ address: candidate.LocalAddress, processId: candidate.OwningProcess }]
      : [];
  });
}

function resetOwnedBuildDirectory(directory: string) {
  const relative = path.relative(repositoryRoot, directory);
  if (relative !== ".installer-work" || path.dirname(directory) !== repositoryRoot)
    throw new Error("Refusing to reset a directory outside the owned installer work root.");
  if (existsSync(directory)) rmSync(directory, { recursive: true, force: true });
  mkdirSync(directory, { recursive: true });
}

function listRelativeFiles(root: string): string[] {
  const result: string[] = [];
  const visit = (directory: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(absolute);
      else if (entry.isFile()) result.push(path.relative(root, absolute).replaceAll("\\", "/"));
      else
        throw new Error(
          `Installer payload contains a reparse point or unsupported entry: ${absolute}`,
        );
    }
  };
  visit(root);
  return result.sort();
}

function checksumFileSync(filePath: string) {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

function readApplicationVersion() {
  const pkg = JSON.parse(readFileSync(path.join(repositoryRoot, "package.json"), "utf8")) as {
    version?: unknown;
  };
  if (typeof pkg.version !== "string" || !/^\d+\.\d+\.\d+$/.test(pkg.version))
    throw new Error("package.json must provide one numeric installer application version.");
  return pkg.version;
}

function newestInstaller(marker: string) {
  const files = readdirSync(outputRoot)
    .filter((file) => file.includes(marker) && file.endsWith(".exe"))
    .map((file) => ({ file, modified: statSync(path.join(outputRoot, file)).mtimeMs }))
    .sort((left, right) => right.modified - left.modified);
  if (!files[0]) throw new Error("Compiled isolated drill installer was not found.");
  return path.join(outputRoot, files[0].file);
}

function systemPowerShell() {
  return path.join(
    process.env.SystemRoot ?? "C:\\Windows",
    "System32",
    "WindowsPowerShell",
    "v1.0",
    "powershell.exe",
  );
}

function escapePowerShellLiteral(value: string) {
  return value.replaceAll("'", "''");
}

function run(
  executable: string,
  args: string[],
  cwd: string,
  extraEnvironment: Record<string, string | undefined> = {},
) {
  const result = spawnSync(executable, args, {
    cwd,
    env: { ...process.env, ...extraEnvironment },
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: 32 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}
