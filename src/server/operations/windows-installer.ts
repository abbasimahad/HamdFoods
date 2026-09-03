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
  binPath: string;
  serviceName: string;
  serviceRunning: boolean;
  toolsPresent: boolean;
};

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

export function classifyPostgresInstallation(
  candidates: readonly PostgresCandidate[],
):
  | { status: "missing" }
  | ({ status: "installed" } & PostgresCandidate)
  | { status: "unsupported"; detectedMajors: number[] } {
  const supported = candidates.find(
    (candidate) =>
      candidate.major === SUPPORTED_POSTGRES_MAJOR &&
      candidate.serviceRunning &&
      candidate.toolsPresent,
  );
  if (supported) return { status: "installed", ...supported };
  if (!candidates.length) return { status: "missing" };
  return {
    status: "unsupported",
    detectedMajors: [...new Set(candidates.map((candidate) => candidate.major))].sort(
      (left, right) => left - right,
    ),
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
}) {
  if (!input.existingConfig && (input.databaseExists || input.roleExists))
    throw new Error(
      "Refusing to claim a pre-existing PostgreSQL role or database without a managed config.",
    );
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
      file.endsWith(".dump") ||
      file.endsWith(".backup") ||
      file.endsWith(".pfx") ||
      file.endsWith(".p12") ||
      file.endsWith(".zip") ||
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
