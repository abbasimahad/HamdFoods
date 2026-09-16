import { spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
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
  discoverInnoSetupCompiler,
  PINNED_NODE_ARCHIVE,
  PINNED_NODE_SHA256,
  PINNED_NODE_VERSION,
  PRODUCTION_INSTALLER_OPTIONS,
  runInstallerDrillWorkflow,
  SUPPORTED_POSTGRES_MAJOR,
  validatePayloadFiles,
  verifyInstallerDrillAuthentication,
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
  if (postgres.status === "installed") {
    console.log(`PostgreSQL Selected Major: ${postgres.major}`);
    console.log(`PostgreSQL Selected Service: ${postgres.serviceName}`);
    console.log(`PostgreSQL Selected Tool Path: ${postgres.binPath}`);
  }
  console.log(`PostgreSQL Tools: ${postgres.status === "installed" ? "PASS" : "FAIL"}`);
  if (postgres.legacyArtifacts.length) {
    console.log("Legacy PostgreSQL Artifacts: WARNING");
    for (const artifact of postgres.legacyArtifacts)
      console.log(`Legacy PostgreSQL ${artifact.major}: UNMANAGED / IGNORED`);
  }
  console.log(`Port 3100: ${port.toUpperCase()}`);
  console.log(`Existing HamdFoodsERP: ${existingInstall ? "YES" : "NO"}`);
  console.log(`Existing Scheduled Task: ${existingTask ? "YES" : "NO"}`);
  console.log(`Tailscale: OPTIONAL ${tailscale ? "INSTALLED" : "NOT INSTALLED"}`);
  console.log(`Installer Compiler: ${compiler ? "PASS" : "FAIL"}`);
  if (compiler) {
    console.log(`Installer Compiler Version: ${compiler.version}`);
    console.log(`Installer Compiler Path: ${compiler.path}`);
  }

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
    "--quiet",
    "--messages-jsonl",
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
  const result = run(compiler.path, args, repositoryRoot);
  const compilerOutput = `${result.stdout}\n${result.stderr}`.trim();
  if (result.status !== 0)
    throw new Error(`Inno Setup compilation failed.${compilerOutput ? `\n${compilerOutput}` : ""}`);
  if (compilerOutput)
    throw new Error(`Inno Setup compilation emitted a warning.\n${compilerOutput}`);
  if (compilerOutput) console.log(compilerOutput);
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
      "Drill installer compiled but was not launched. Set HAMDFOODS_RUN_INSTALLER_DRILL=1 only during an approved isolated drill.",
    );
  const installer = newestInstaller("InstallDrill");
  const passwordBytes = randomBytes(32);
  let password: string | undefined = passwordBytes.toString("base64url");
  const name = "Installer Drill Administrator";
  const email = "installer-drill-admin@hamdfoods.invalid";
  try {
    const environment = {
      ...process.env,
      HAMDFOODS_AUTOMATED_INSTALL_DRILL: "1",
      HAMDFOODS_DRILL_ADMIN_NAME: name,
      HAMDFOODS_DRILL_ADMIN_EMAIL: email,
      HAMDFOODS_DRILL_ADMIN_PASSWORD: password,
    };
    await runInstallerDrillWorkflow({
      install: (stage) => runSilentDrillInstaller(installer, environment, stage),
      authenticate: () => verifyDrillAuthentication(email, password!),
      backup: () => runElevatedDrillOperation("backup"),
      restart: () => runElevatedDrillOperation("restart"),
      uninstall: runSilentDrillUninstaller,
    });
    console.log(
      "Automated InstallDrill recovery, backup, restart, repair, authentication, and uninstall verification passed.",
    );
  } finally {
    passwordBytes.fill(0);
    password = undefined;
  }
}

function runElevatedDrillOperation(operation: "backup" | "restart") {
  const appRoot = "C:\\Program Files\\HamdFoodsERP-InstallDrill";
  const dataRoot = "C:\\ProgramData\\HamdFoodsERP-InstallDrill";
  const taskName =
    operation === "backup" ? "HamdFoodsERP-InstallDrill-Backup" : "HamdFoodsERP-InstallDrill";
  const body = `
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$appRoot = '${escapePowerShellLiteral(appRoot)}'
$dataRoot = '${escapePowerShellLiteral(dataRoot)}'
$taskName = '${taskName}'
$task = Get-ScheduledTask -TaskName $taskName -ErrorAction Stop
if ($task.Principal.UserId -ne 'SYSTEM' -or @($task.Actions | Where-Object { -not [StringComparer]::OrdinalIgnoreCase.Equals([string]$_.WorkingDirectory, $appRoot) }).Count -ne 0) { throw 'Drill task identity mismatch.' }
${
  operation === "backup"
    ? `$before = (Get-ScheduledTaskInfo -TaskName $taskName).LastRunTime
Start-ScheduledTask -TaskName $taskName
$deadline = [DateTime]::UtcNow.AddMinutes(3)
do {
  Start-Sleep -Milliseconds 500
  $current = Get-ScheduledTask -TaskName $taskName -ErrorAction Stop
  $info = Get-ScheduledTaskInfo -TaskName $taskName -ErrorAction Stop
} while (($current.State -eq 'Running' -or $info.LastRunTime -le $before) -and [DateTime]::UtcNow -lt $deadline)
if ($current.State -eq 'Running' -or $info.LastRunTime -le $before -or $info.LastTaskResult -ne 0) { throw 'Drill backup task did not complete successfully.' }
$manifestFile = Get-ChildItem -LiteralPath (Join-Path $dataRoot 'backups') -Filter '*.manifest.json' -File | Sort-Object LastWriteTimeUtc -Descending | Select-Object -First 1
if (-not $manifestFile -or $manifestFile.LastWriteTime -lt $before) { throw 'Drill backup did not create a current manifest.' }
$manifest = Get-Content -Raw -LiteralPath $manifestFile.FullName | ConvertFrom-Json
if ($manifest.databaseName -ne 'hamd_foods_erp_installer_drill' -or $manifest.status -ne 'complete' -or $manifest.sha256 -notmatch '^[a-f0-9]{64}$') { throw 'Drill backup manifest identity or status is invalid.' }
$dump = Join-Path $manifestFile.DirectoryName ([string]$manifest.dumpFilename)
if (-not (Test-Path -LiteralPath $dump -PathType Leaf) -or (Get-Item -LiteralPath $dump).Length -ne [long]$manifest.byteSize) { throw 'Drill backup dump size verification failed.' }
if ((Get-FileHash -LiteralPath $dump -Algorithm SHA256).Hash.ToLowerInvariant() -cne [string]$manifest.sha256) { throw 'Drill backup SHA-256 verification failed.' }
& 'C:\\Program Files\\PostgreSQL\\16\\bin\\pg_restore.exe' --list $dump *> $null
if ($LASTEXITCODE -ne 0) { throw 'Drill backup readability verification failed.' }`
    : `Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
$listeners = @(Get-NetTCPConnection -State Listen -LocalPort 3200 -ErrorAction SilentlyContinue)
$expectedNode = Join-Path $appRoot 'runtime\\node\\node.exe'
foreach ($listener in $listeners) {
  $process = Get-Process -Id $listener.OwningProcess -ErrorAction Stop
  if ($listener.LocalAddress -notin @('127.0.0.1', '::1') -or $process.ProcessName -ne 'node' -or -not [StringComparer]::OrdinalIgnoreCase.Equals([string]$process.Path, $expectedNode)) { throw 'Port 3200 is not owned by the exact drill runtime.' }
  $termination = Start-Process -FilePath (Join-Path $env:SystemRoot 'System32\\taskkill.exe') -ArgumentList @('/PID', [string]$listener.OwningProcess, '/T', '/F') -WindowStyle Hidden -Wait -PassThru
  if ($termination.ExitCode -ne 0) { throw 'Exact drill runtime termination failed.' }
}
$closeDeadline = [DateTime]::UtcNow.AddSeconds(30)
while ((Get-NetTCPConnection -State Listen -LocalPort 3200 -ErrorAction SilentlyContinue) -and [DateTime]::UtcNow -lt $closeDeadline) { Start-Sleep -Milliseconds 250 }
if (Get-NetTCPConnection -State Listen -LocalPort 3200 -ErrorAction SilentlyContinue) { throw 'Port 3200 did not close during drill restart.' }
Start-ScheduledTask -TaskName $taskName
$healthDeadline = [DateTime]::UtcNow.AddSeconds(60)
do {
  try { $health = Invoke-RestMethod -Uri 'http://127.0.0.1:3200/api/health' -TimeoutSec 5 } catch { $health = $null }
  if ($health.status -eq 'ok') { break }
  Start-Sleep -Seconds 2
} while ([DateTime]::UtcNow -lt $healthDeadline)
if ($health.status -ne 'ok') { throw 'Drill runtime did not become healthy after restart.' }
$finalListeners = @(Get-NetTCPConnection -State Listen -LocalPort 3200 -ErrorAction Stop)
if ($finalListeners.Count -ne 1 -or $finalListeners[0].LocalAddress -ne '127.0.0.1') { throw 'Drill restart did not restore an IPv4 loopback-only listener.' }`
}
`;
  const encoded = Buffer.from(body, "utf16le").toString("base64");
  const powershell = systemPowerShell();
  const elevation = `$process = Start-Process -FilePath '${escapePowerShellLiteral(powershell)}' -Verb RunAs -ArgumentList @('-NoLogo','-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-EncodedCommand','${encoded}') -WindowStyle Hidden -Wait -PassThru; exit $process.ExitCode`;
  const result = run(
    powershell,
    ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", elevation],
    repositoryRoot,
  );
  if (result.status !== 0)
    throw new Error(`Elevated InstallDrill ${operation} verification failed.`);
}

function runSilentDrillUninstaller() {
  const appRoot = "C:\\Program Files\\HamdFoodsERP-InstallDrill";
  const uninstaller = path.join(appRoot, "unins000.exe");
  if (!existsSync(uninstaller)) throw new Error("Isolated installer drill uninstaller is missing.");
  const result = spawnSync(uninstaller, ["/VERYSILENT", "/SUPPRESSMSGBOXES", "/NORESTART"], {
    cwd: appRoot,
    stdio: "ignore",
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error("Isolated installer uninstall drill failed.");
  if (existsSync(appRoot))
    throw new Error("Isolated installer left its Program Files payload behind.");
}

function runSilentDrillInstaller(
  installer: string,
  environment: NodeJS.ProcessEnv,
  stage: "recovery" | "repair",
) {
  const innoLog = path.join(workRoot, `drill-${stage}-setup.log`);
  const result = spawnSync(
    installer,
    [
      "/DRILL=1",
      "/VERYSILENT",
      "/SUPPRESSMSGBOXES",
      "/NORESTART",
      "/TASKS=dailybackup",
      `/LOG=${innoLog}`,
    ],
    {
      cwd: outputRoot,
      env: environment,
      stdio: "ignore",
      windowsHide: true,
    },
  );
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(`Isolated installer ${stage} drill did not complete successfully.`);
}

async function verifyDrillAuthentication(email: string, password: string) {
  const origin = "http://127.0.0.1:3200";
  await verifyInstallerDrillAuthentication({ origin, email, password });
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
      return name !== ".env" && !name.startsWith(".env.") && isRuntimePayloadFile(source);
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
    ["scripts/account-recovery.ts", "account-recovery.mjs"],
    ["scripts/updates/update-orchestrator-cli.ts", "update-orchestrator.mjs"],
  ] as const;
  for (const [entry, output] of entries)
    await build({
      entryPoints: [path.join(repositoryRoot, entry)],
      outfile: path.join(operationsRoot, output),
      bundle: true,
      platform: "node",
      format: "esm",
      target: "node24",
      packages: "external",
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
  const pending = [
    "prisma",
    "@prisma/client",
    "@prisma/adapter-pg",
    "pg",
    "better-auth",
    "@better-auth/prisma-adapter",
    "server-only",
    "zod",
    "decimal.js",
    "dotenv",
  ];
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
          isRuntimePayloadFile(candidate) &&
          !segments.some((segment) =>
            ["test", "tests", "__tests__", "fixtures", "examples"].includes(segment),
          ) &&
          !/\.(?:test|spec)\.[cm]?[jt]sx?$/.test(relative)
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

function isRuntimePayloadFile(candidate: string) {
  if (!existsSync(candidate) || !statSync(candidate).isFile()) return true;
  const name = path.basename(candidate).toLowerCase();
  return (
    !name.endsWith(".map") &&
    !/\.d\.[cm]?ts$/.test(name) &&
    !name.endsWith(".md") &&
    !name.endsWith(".markdown")
  );
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
  const installationRoot = path.join(process.env.ProgramFiles ?? "C:\\Program Files", "PostgreSQL");
  if (!existsSync(installationRoot)) return [];
  const candidates: PostgresCandidate[] = [];
  const configuredBin = process.env.POSTGRES_BIN
    ? path.normalize(process.env.POSTGRES_BIN)
    : undefined;
  const majors = readdirSync(installationRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^\d+$/.test(entry.name))
    .map((entry) => Number(entry.name));
  for (const major of majors) {
    const candidateRoot = path.join(installationRoot, String(major));
    const binPath = path.join(candidateRoot, "bin");
    const serviceName = `postgresql-x64-${major}`;
    const service = postgresServiceState(serviceName);
    candidates.push({
      major,
      installationRoot: candidateRoot,
      binPath,
      serviceName,
      serviceRegistered: service.registered,
      serviceRunning: service.running,
      serverBinaryPresent: existsSync(path.join(binPath, "postgres.exe")),
      toolsPresent: ["psql.exe", "pg_isready.exe", "pg_dump.exe", "pg_restore.exe"].every((tool) =>
        existsSync(path.join(binPath, tool)),
      ),
      dataDirectoryPresent: existsSync(path.join(candidateRoot, "data", "PG_VERSION")),
      hamdFoodsManaged:
        configuredBin !== undefined &&
        configuredBin.toLowerCase() === path.normalize(binPath).toLowerCase(),
    });
  }
  return candidates;
}

function discoverInnoCompiler() {
  return discoverInnoSetupCompiler({
    configuredPath: process.env.INNO_SETUP_COMPILER,
    programFiles: process.env.ProgramFiles ?? "C:\\Program Files",
    programFilesX86: process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)",
    localAppData: process.env.LOCALAPPDATA,
    isFile(candidate) {
      try {
        return statSync(candidate).isFile();
      } catch {
        return false;
      }
    },
    execute(candidate, args) {
      return run(candidate, [...args], repositoryRoot);
    },
  });
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

function postgresServiceState(serviceName: string) {
  const result = run(
    systemPowerShell(),
    [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      `$service = Get-Service -Name '${escapePowerShellLiteral(serviceName)}' -ErrorAction SilentlyContinue; if (-not $service) { exit 2 }; if ($service.Status -eq 'Running') { exit 0 }; exit 1`,
    ],
    repositoryRoot,
  );
  return { registered: result.status === 0 || result.status === 1, running: result.status === 0 };
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
