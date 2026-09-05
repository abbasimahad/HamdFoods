import { randomBytes } from "node:crypto";
import path from "node:path";

export const INSTALLER_PRODUCT_NAME = "Hamd Foods ERP";
export const SUPPORTED_POSTGRES_MAJOR = 16;
export const PINNED_NODE_VERSION = "24.11.1";
export const PINNED_NODE_ARCHIVE = `node-v${PINNED_NODE_VERSION}-win-x64.zip`;
export const PINNED_NODE_SHA256 =
  "5355ae6d7c49eddcfde7d34ac3486820600a831bf81dc3bdca5c8db6a9bb0e76";

export type InstallerOptions = {
  appRoot: string;
  dataRoot: string;
  taskName: string;
  backupTaskName: string;
  port: number;
  databaseName: string;
  roleName: string;
  drill: boolean;
};

export type PostgresCandidate = {
  major: number;
  installationRoot: string;
  binPath: string;
  serviceName: string;
  serviceRegistered: boolean;
  serviceRunning: boolean;
  serverBinaryPresent: boolean;
  toolsPresent: boolean;
  dataDirectoryPresent: boolean;
  hamdFoodsManaged: boolean;
};

export type LegacyPostgresArtifact = {
  major: number;
  rootPath: string;
  classification: "unmanaged";
  disposition: "ignore";
};

export type InnoSetupDiscoveryInput = {
  configuredPath?: string | undefined;
  programFiles?: string | undefined;
  programFilesX86?: string | undefined;
  localAppData?: string | undefined;
  isFile: (candidate: string) => boolean;
  execute: (
    candidate: string,
    args: readonly string[],
  ) => { status: number | null; stdout: string; stderr: string };
};

export type InnoSetupCompiler = {
  path: string;
  version: string;
};

export type InstallerRecoveryState = {
  owned: boolean;
  completedStages: readonly string[];
  provisioningComplete: boolean;
};

export async function verifyInstallerDrillAuthentication(input: {
  origin: string;
  email: string;
  password: string;
  request?: typeof fetch;
}) {
  const request = input.request ?? fetch;
  await waitForStableInstallerDrillHealth(input.origin, request);
  const signIn = await request(`${input.origin}/api/auth/sign-in/email`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: input.origin },
    body: JSON.stringify({ email: input.email, password: input.password }),
    redirect: "manual",
  });
  if (!signIn.ok) throw new Error("Automated InstallDrill authentication failed.");
  const setCookies = signIn.headers.getSetCookie();
  const cookie = setCookies.map((value) => value.split(";", 1)[0]).join("; ");
  if (!cookie) throw new Error("Automated InstallDrill authentication returned no session.");

  const dashboard = await request(`${input.origin}/dashboard`, {
    headers: { cookie },
    redirect: "manual",
  });
  if (dashboard.status !== 200) throw new Error("Automated InstallDrill dashboard access failed.");

  const administration = await request(`${input.origin}/administration/users`, {
    headers: { cookie },
    redirect: "manual",
  });
  if (administration.status !== 200)
    throw new Error("Automated InstallDrill SUPER_ADMIN authorization failed.");

  const signUp = await request(`${input.origin}/api/auth/sign-up/email`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: input.origin },
    body: JSON.stringify({
      name: "Disallowed Drill Signup",
      email: "disallowed-installer-signup@hamdfoods.invalid",
      password: input.password,
    }),
    redirect: "manual",
  });
  if (signUp.status !== 400) throw new Error("Automated InstallDrill found direct signup enabled.");

  const signOut = await request(`${input.origin}/api/auth/sign-out`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie, origin: input.origin },
    body: JSON.stringify({}),
    redirect: "manual",
  });
  if (!signOut.ok) throw new Error("Automated InstallDrill logout failed.");

  const signedOutDashboard = await request(`${input.origin}/dashboard`, {
    headers: { cookie },
    redirect: "manual",
  });
  if (signedOutDashboard.status < 300 || signedOutDashboard.status >= 400)
    throw new Error("Automated InstallDrill logout left the dashboard session active.");
}

async function waitForStableInstallerDrillHealth(origin: string, request: typeof fetch) {
  let consecutivePasses = 0;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      const response = await request(`${origin}/api/health`, { redirect: "manual" });
      consecutivePasses = response.status === 200 ? consecutivePasses + 1 : 0;
      if (consecutivePasses === 2) return;
    } catch {
      consecutivePasses = 0;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("Automated InstallDrill runtime was not stably reachable for authentication.");
}

export async function runInstallerDrillWorkflow(input: {
  install: (stage: "recovery" | "repair") => void | Promise<void>;
  authenticate: () => Promise<void>;
  backup: () => void | Promise<void>;
  restart: () => void | Promise<void>;
  uninstall: () => void | Promise<void>;
}) {
  await input.install("recovery");
  await input.authenticate();
  await input.backup();
  await input.restart();
  await input.authenticate();
  await input.install("repair");
  await input.authenticate();
  await input.uninstall();
}

export function discoverInnoSetupCompiler(
  input: InnoSetupDiscoveryInput,
): InnoSetupCompiler | undefined {
  if (input.configuredPath) {
    const configured = validateInnoSetupCandidate(input.configuredPath, input);
    if (!configured)
      throw new Error(
        "The explicit compiler override must be an absolute, executable Inno Setup 7 ISCC.exe.",
      );
    return configured;
  }

  const candidates = [
    input.programFiles
      ? path.win32.join(input.programFiles, "Inno Setup 7", "ISCC.exe")
      : undefined,
    input.programFilesX86
      ? path.win32.join(input.programFilesX86, "Inno Setup 7", "ISCC.exe")
      : undefined,
    input.localAppData
      ? path.win32.join(input.localAppData, "Programs", "Inno Setup 7", "ISCC.exe")
      : undefined,
  ];
  for (const candidate of candidates) {
    if (!candidate) continue;
    const validated = validateInnoSetupCandidate(candidate, input);
    if (validated) return validated;
  }
  return undefined;
}

export const PRODUCTION_INSTALLER_OPTIONS: InstallerOptions = {
  appRoot: "C:\\Program Files\\HamdFoodsERP",
  dataRoot: "C:\\ProgramData\\HamdFoodsERP",
  taskName: "HamdFoodsERP",
  backupTaskName: "HamdFoodsERP-Backup",
  port: 3100,
  databaseName: "hamd_foods_erp",
  roleName: "hamd_erp",
  drill: false,
};

export const DRILL_INSTALLER_OPTIONS: InstallerOptions = {
  appRoot: "C:\\Program Files\\HamdFoodsERP-InstallDrill",
  dataRoot: "C:\\ProgramData\\HamdFoodsERP-InstallDrill",
  taskName: "HamdFoodsERP-InstallDrill",
  backupTaskName: "HamdFoodsERP-InstallDrill-Backup",
  port: 3200,
  databaseName: "hamd_foods_erp_installer_drill",
  roleName: "hamd_erp_installer_drill",
  drill: true,
};

export function validateInstallerOptions(input: InstallerOptions): InstallerOptions {
  const appRoot = assertManagedRoot(input.appRoot, "C:\\Program Files", "application");
  const dataRoot = assertManagedRoot(input.dataRoot, "C:\\ProgramData", "data");
  assertTaskName(input.taskName, "task name");
  assertTaskName(input.backupTaskName, "backup task name");
  assertDatabaseIdentifier(input.databaseName, "database name");
  assertDatabaseIdentifier(input.roleName, "role name");
  if (input.roleName.toLowerCase() === "postgres")
    throw new Error("The PostgreSQL application role cannot be postgres.");
  if (
    !Number.isSafeInteger(input.port) ||
    input.port < 1 ||
    input.port > 65_535 ||
    input.port === 5432
  )
    throw new Error("Installer port must be an integer between 1 and 65535 other than 5432.");

  if (input.drill) {
    const productionValues = Object.values(PRODUCTION_INSTALLER_OPTIONS);
    const isolatedValues = [
      appRoot,
      dataRoot,
      input.taskName,
      input.backupTaskName,
      input.port,
      input.databaseName,
      input.roleName,
    ];
    if (
      isolatedValues.some((value) => productionValues.includes(value as never)) ||
      path.win32.basename(appRoot) !== "HamdFoodsERP-InstallDrill" ||
      path.win32.basename(dataRoot) !== "HamdFoodsERP-InstallDrill"
    )
      throw new Error("An isolated drill must not use any production resource name or path.");
  } else if (
    appRoot !== PRODUCTION_INSTALLER_OPTIONS.appRoot ||
    dataRoot !== PRODUCTION_INSTALLER_OPTIONS.dataRoot ||
    input.taskName !== PRODUCTION_INSTALLER_OPTIONS.taskName ||
    input.backupTaskName !== PRODUCTION_INSTALLER_OPTIONS.backupTaskName ||
    input.databaseName !== PRODUCTION_INSTALLER_OPTIONS.databaseName ||
    input.roleName !== PRODUCTION_INSTALLER_OPTIONS.roleName
  ) {
    throw new Error(
      "Production installation roots must use the canonical Program Files and ProgramData paths.",
    );
  }

  return { ...input, appRoot, dataRoot };
}

export function resolveProductionEnvFile(input: {
  repositoryRoot: string;
  configuredPath?: string | undefined;
  dataRoot?: string | undefined;
  programDataRoot?: string | undefined;
}): string {
  if (!input.configuredPath)
    return path.win32.normalize(path.win32.join(input.repositoryRoot, ".env.production"));
  if (!input.dataRoot) throw new Error("HAMDFOODS_DATA_ROOT is required with HAMDFOODS_ENV_FILE.");
  const programDataRoot = path.win32.normalize(input.programDataRoot ?? "C:\\ProgramData");
  if (programDataRoot !== "C:\\ProgramData")
    throw new Error("Installed configuration must remain under canonical C:\\ProgramData.");
  const dataRoot = assertManagedRoot(input.dataRoot, programDataRoot, "data");
  const configuredPath = path.win32.normalize(input.configuredPath);
  const expectedPath = path.win32.join(dataRoot, "config", ".env.production");
  if (configuredPath !== expectedPath)
    throw new Error("HAMDFOODS_ENV_FILE must be the exact managed ProgramData config path.");
  return configuredPath;
}

export function generateInstallationSecrets(
  randomSource: (size: number) => Uint8Array = randomBytes,
): { databasePassword: string; betterAuthSecret: string } {
  return {
    databasePassword: Buffer.from(randomSource(32)).toString("hex"),
    betterAuthSecret: Buffer.from(randomSource(48)).toString("hex"),
  };
}

export function redactInstallerText(text: string, secrets: readonly string[]): string {
  return secrets
    .filter(Boolean)
    .sort((left, right) => right.length - left.length)
    .reduce((result, secret) => result.split(secret).join("[REDACTED]"), text);
}

export function classifyPostgresInstallation(candidates: readonly PostgresCandidate[]):
  | { status: "missing"; legacyArtifacts: LegacyPostgresArtifact[] }
  | ({ status: "installed"; legacyArtifacts: LegacyPostgresArtifact[] } & PostgresCandidate)
  | {
      status: "unsupported";
      detectedMajors: number[];
      legacyArtifacts: LegacyPostgresArtifact[];
    } {
  const legacyArtifacts = candidates
    .filter(isUnmanagedPostgresArtifact)
    .map((candidate) => ({
      major: candidate.major,
      rootPath: candidate.installationRoot,
      classification: "unmanaged" as const,
      disposition: "ignore" as const,
    }))
    .sort((left, right) => left.major - right.major || left.rootPath.localeCompare(right.rootPath));
  const selectable = candidates
    .filter((candidate) => !isUnmanagedPostgresArtifact(candidate))
    .sort(
      (left, right) =>
        postgresSelectionPriority(right) - postgresSelectionPriority(left) ||
        left.installationRoot.localeCompare(right.installationRoot),
    );
  const conflictingMajors = [
    ...new Set(
      selectable
        .filter((candidate) => candidate.major !== SUPPORTED_POSTGRES_MAJOR)
        .map((candidate) => candidate.major),
    ),
  ].sort((left, right) => left - right);
  if (conflictingMajors.length)
    return { status: "unsupported", detectedMajors: conflictingMajors, legacyArtifacts };

  const supported = selectable.find(
    (candidate) =>
      candidate.major === SUPPORTED_POSTGRES_MAJOR &&
      candidate.serviceRunning &&
      candidate.serverBinaryPresent &&
      candidate.toolsPresent,
  );
  if (supported) return { status: "installed", legacyArtifacts, ...supported };
  if (!selectable.length) return { status: "missing", legacyArtifacts };
  return {
    status: "unsupported",
    detectedMajors: [...new Set(selectable.map((candidate) => candidate.major))].sort(
      (left, right) => left - right,
    ),
    legacyArtifacts,
  };
}

export function classifyPort(listeners: readonly { address: string; owner: string }[]): string {
  if (!listeners.length) return "available";
  return listeners.every(
    (listener) => isLoopbackAddress(listener.address) && listener.owner === "HamdFoodsERP",
  )
    ? "owned"
    : "occupied";
}

export function assertLoopbackListeners(listeners: readonly { address: string }[]): void {
  if (!listeners.length || listeners.some((listener) => !isLoopbackAddress(listener.address)))
    throw new Error("PostgreSQL listeners must be present and loopback-only.");
}

export function buildConfigAclCommand(configPath: string): {
  executable: string;
  args: string[];
} {
  if (!path.win32.isAbsolute(configPath) || path.win32.basename(configPath) !== ".env.production")
    throw new Error("Config ACL target must be an absolute .env.production path.");
  return {
    executable: "C:\\Windows\\System32\\icacls.exe",
    args: [
      path.win32.normalize(configPath),
      "/inheritance:r",
      "/grant:r",
      "*S-1-5-18:F",
      "*S-1-5-32-544:F",
    ],
  };
}

export function buildApplicationTaskDefinition(options: InstallerOptions) {
  const safe = validateInstallerOptions(options);
  return {
    taskName: safe.taskName,
    userId: "SYSTEM",
    executable: "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
    runner: path.win32.join(safe.appRoot, "windows", "Run-HamdFoodsERP.ps1"),
    workingDirectory: safe.appRoot,
    bundledNode: path.win32.join(safe.appRoot, "runtime", "node", "node.exe"),
    environmentFile: path.win32.join(safe.dataRoot, "config", ".env.production"),
    startsAtBoot: true,
    restartCount: 3,
    restartIntervalMinutes: 1,
    interactiveLoginRequired: false,
  };
}

export function buildBackupTaskDefinition(options: InstallerOptions) {
  const safe = validateInstallerOptions(options);
  return {
    taskName: safe.backupTaskName,
    userId: "SYSTEM",
    executable: "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
    runner: path.win32.join(safe.appRoot, "windows", "Backup-HamdFoodsERP.ps1"),
    workingDirectory: safe.appRoot,
    schedule: "02:00",
    overlapPolicy: "ignore-new",
    logPath: path.win32.join(safe.dataRoot, "logs", "backup.log"),
  };
}

export function createInstallationPlan(input: {
  existingConfig: boolean;
  existingTask: boolean;
  databaseExists: boolean;
  roleExists: boolean;
  installerOwned?: boolean;
}) {
  if (!input.existingConfig && (input.databaseExists || input.roleExists))
    throw new Error(
      "Refusing to claim a pre-existing PostgreSQL role or database without a managed config.",
    );
  if (input.existingConfig && !input.installerOwned)
    throw new Error("Refusing repair because installer ownership provenance is absent.");
  if (input.existingConfig)
    return {
      mode: "repair" as const,
      generateSecrets: false,
      backupBeforeMigrations: true,
      reconcileTask: true,
    };
  return {
    mode: "fresh" as const,
    generateSecrets: true,
    backupBeforeMigrations: false,
    reconcileTask: input.existingTask,
  };
}

const resumableProvisioningStages = [
  "ConfigurationWrite",
  "MigrationDeployment",
  "SeedExecution",
  "AdministratorBootstrap",
  "TaskRegistration",
  "RuntimeStartup",
] as const;

export function classifyInstallerRecovery(input: {
  configExists: boolean;
  databaseExists: boolean;
  roleExists: boolean;
  state: InstallerRecoveryState | undefined;
}) {
  if (!input.configExists && !input.databaseExists && !input.roleExists && !input.state)
    return {
      mode: "fresh" as const,
      nextStage: "PostgreSQLCredentialAcquisition" as const,
      bootstrapRequired: true,
    };
  if (!input.state?.owned)
    throw new Error(
      "Installer ownership provenance is absent; refusing to claim existing resources.",
    );
  if (!input.configExists || !input.databaseExists || !input.roleExists)
    throw new Error("Installer-owned recovery state conflicts with the actual managed resources.");

  const nextStage = resumableProvisioningStages.find(
    (stage) => !input.state!.completedStages.includes(stage),
  );
  if (!nextStage && !input.state.provisioningComplete)
    throw new Error("Installer recovery state is incomplete and has no safe resumable stage.");
  return {
    mode: input.state.provisioningComplete ? ("repair" as const) : ("resume" as const),
    nextStage: nextStage ?? "PreMigrationBackup",
    bootstrapRequired: !input.state.completedStages.includes("AdministratorBootstrap"),
  };
}

export function createUninstallPlan(options: InstallerOptions) {
  const safe = validateInstallerOptions(options);
  return {
    removeTasks: [safe.taskName, safe.backupTaskName],
    removeAppRoot: safe.appRoot,
    preserve: [safe.dataRoot, `database:${safe.databaseName}`, `role:${safe.roleName}`],
  };
}

export function validatePayloadFiles(files: readonly string[]): void {
  const normalized = files.map((file) => file.replaceAll("\\", "/").toLowerCase());
  const required = [
    "app/server.js",
    "runtime/node/node.exe",
    "operations/prisma/schema.prisma",
    "operations/prisma.config.mjs",
    "operations/seed-all.mjs",
    "operations/bootstrap-super-admin.mjs",
    "operations/database-backup.mjs",
    "windows/backup-hamdfoodserp.ps1",
    "windows/run-hamdfoodserp.ps1",
    "windows/setup-hamdfoodserp.ps1",
    "package.json",
  ];
  if (required.some((requiredFile) => !normalized.includes(requiredFile)))
    throw new Error("Installer payload is missing a required runtime file.");
  const forbidden = normalized.find(
    (file) =>
      file.includes("/.git/") ||
      file.startsWith(".git/") ||
      /(?:^|\/)\.env(?:\.|$)/.test(file) ||
      file.startsWith("src/") ||
      /\.test\.[cm]?[jt]sx?$/.test(file) ||
      file.includes("playwright-report") ||
      file.endsWith(".map") ||
      /\.d\.[cm]?ts$/.test(file) ||
      file.endsWith(".md") ||
      file.endsWith(".markdown") ||
      file.endsWith(".dump") ||
      file.endsWith(".backup") ||
      file.endsWith(".pfx") ||
      file.endsWith(".p12") ||
      file.endsWith(".zip") ||
      file.endsWith(".map") ||
      file.endsWith(".d.ts") ||
      /(?:^|\/)(?:readme|changelog|changes|history)(?:\.[^/]*)?$/i.test(file) ||
      /postgres(?:ql)?[^/]*installer.*\.exe$/.test(file),
  );
  if (forbidden) throw new Error(`Installer payload contains a forbidden file: ${forbidden}`);
}

export function installerSecurityCapabilities() {
  return {
    dockerRequired: false,
    inboundFirewallPorts: [] as number[],
    tailscaleOptional: true,
    altersTailscale: false,
    exposesPostgres: false,
  };
}

function assertManagedRoot(value: string, parent: string, label: string) {
  if (!path.win32.isAbsolute(value) || value.startsWith("\\\\"))
    throw new Error(`Installer ${label} root must be an absolute local Windows path.`);
  const normalized = path.win32.normalize(value);
  const relative = path.win32.relative(path.win32.normalize(parent), normalized);
  if (
    !relative ||
    relative.startsWith("..") ||
    path.win32.isAbsolute(relative) ||
    relative.includes(path.win32.sep) ||
    !/^HamdFoodsERP(?:-InstallDrill)?$/.test(relative)
  )
    throw new Error(`Installer ${label} root must be a direct managed child of ${parent}.`);
  return normalized;
}

function assertDatabaseIdentifier(value: string, label: string) {
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(value))
    throw new Error(`Installer ${label} must be a safe lowercase PostgreSQL identifier.`);
}

function assertTaskName(value: string, label: string) {
  if (!/^HamdFoodsERP(?:-InstallDrill)?(?:-Backup)?$/.test(value))
    throw new Error(`Installer ${label} is not a managed HamdFoodsERP task name.`);
}

function isLoopbackAddress(value: string) {
  return value === "127.0.0.1" || value === "::1" || value === "[::1]";
}

function isUnmanagedPostgresArtifact(candidate: PostgresCandidate) {
  return (
    candidate.dataDirectoryPresent &&
    !candidate.serverBinaryPresent &&
    !candidate.toolsPresent &&
    !candidate.serviceRegistered &&
    !candidate.serviceRunning &&
    !candidate.hamdFoodsManaged
  );
}

function postgresSelectionPriority(candidate: PostgresCandidate) {
  if (candidate.hamdFoodsManaged) return 3;
  if (candidate.serviceRunning) return 2;
  if (candidate.serviceRegistered) return 1;
  return 0;
}

function validateInnoSetupCandidate(
  candidate: string,
  input: InnoSetupDiscoveryInput,
): InnoSetupCompiler | undefined {
  if (
    !path.win32.isAbsolute(candidate) ||
    path.win32.basename(candidate).toLowerCase() !== "iscc.exe" ||
    !input.isFile(candidate)
  )
    return undefined;
  let result: ReturnType<InnoSetupDiscoveryInput["execute"]>;
  try {
    result = input.execute(candidate, ["--version"]);
  } catch {
    return undefined;
  }
  if (result.status !== 0) return undefined;
  const match = /^7\.\d+(?:\.\d+)?(?:\.\d+)?$/.exec(result.stdout.trim());
  if (!match) return undefined;
  return { path: path.win32.normalize(candidate), version: match[0] };
}
