import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  assertLoopbackListeners,
  buildApplicationTaskDefinition,
  buildBackupTaskDefinition,
  buildConfigAclCommand,
  classifyPort,
  classifyPostgresInstallation,
  createInstallationPlan,
  createUninstallPlan,
  generateInstallationSecrets,
  installerSecurityCapabilities,
  redactInstallerText,
  resolveProductionEnvFile,
  validateInstallerOptions,
  validatePayloadFiles,
  type InstallerOptions,
} from "./windows-installer";

const productionOptions: InstallerOptions = {
  appRoot: "C:\\Program Files\\HamdFoodsERP",
  dataRoot: "C:\\ProgramData\\HamdFoodsERP",
  taskName: "HamdFoodsERP",
  backupTaskName: "HamdFoodsERP-Backup",
  port: 3100,
  databaseName: "hamd_foods_erp",
  roleName: "hamd_erp",
  drill: false,
};

const drillOptions: InstallerOptions = {
  appRoot: "C:\\Program Files\\HamdFoodsERP-InstallDrill",
  dataRoot: "C:\\ProgramData\\HamdFoodsERP-InstallDrill",
  taskName: "HamdFoodsERP-InstallDrill",
  backupTaskName: "HamdFoodsERP-InstallDrill-Backup",
  port: 3200,
  databaseName: "hamd_foods_erp_installer_drill",
  roleName: "hamd_erp_installer_drill",
  drill: true,
};

describe("Windows installer safety model", () => {
  it("accepts only canonical production or isolated drill resources", () => {
    // Defect caught: a drill could overwrite the live Program Files, ProgramData, task, port, role, or database resources.
    expect(validateInstallerOptions(productionOptions)).toEqual(productionOptions);
    expect(validateInstallerOptions(drillOptions)).toEqual(drillOptions);
    for (const unsafe of [
      { ...drillOptions, appRoot: productionOptions.appRoot },
      { ...drillOptions, dataRoot: productionOptions.dataRoot },
      { ...drillOptions, taskName: productionOptions.taskName },
      { ...drillOptions, port: productionOptions.port },
      { ...drillOptions, databaseName: productionOptions.databaseName },
      { ...drillOptions, roleName: productionOptions.roleName },
    ])
      expect(() => validateInstallerOptions(unsafe)).toThrowError(/isolated drill/i);
  });

  it("rejects traversal, network shares, profiles, and invalid database identifiers or ports", () => {
    // Defect caught: elevated setup fields could escape controlled roots or inject SQL/task syntax.
    expect(() =>
      validateInstallerOptions({ ...productionOptions, appRoot: "C:\\Program Files\\..\\Windows" }),
    ).toThrow();
    expect(() =>
      validateInstallerOptions({
        ...productionOptions,
        dataRoot: "\\\\server\\share\\HamdFoodsERP",
      }),
    ).toThrow();
    expect(() =>
      validateInstallerOptions({
        ...productionOptions,
        databaseName: 'erp"; DROP DATABASE postgres;--',
      }),
    ).toThrow();
    expect(() =>
      validateInstallerOptions({ ...productionOptions, roleName: "postgres" }),
    ).toThrow();
    expect(() => validateInstallerOptions({ ...productionOptions, port: 0 })).toThrow();
    expect(() => validateInstallerOptions({ ...productionOptions, port: 5432 })).toThrow();
    expect(validateInstallerOptions({ ...productionOptions, port: 3201 }).port).toBe(3201);
  });

  it("selects the repository config by default and only the exact installed ProgramData config explicitly", () => {
    // Defect caught: installed startup could load secrets from a wildcard, relative, or attacker-controlled path.
    expect(resolveProductionEnvFile({ repositoryRoot: "E:\\Factory_project" })).toBe(
      path.win32.normalize("E:\\Factory_project\\.env.production"),
    );
    expect(
      resolveProductionEnvFile({
        repositoryRoot: "E:\\Factory_project",
        configuredPath: "C:\\ProgramData\\HamdFoodsERP\\config\\.env.production",
        dataRoot: "C:\\ProgramData\\HamdFoodsERP",
        programDataRoot: "C:\\ProgramData",
      }),
    ).toBe("C:\\ProgramData\\HamdFoodsERP\\config\\.env.production");
    expect(() =>
      resolveProductionEnvFile({
        repositoryRoot: "E:\\Factory_project",
        configuredPath: "C:\\Users\\Public\\.env.production",
        dataRoot: "C:\\ProgramData\\HamdFoodsERP",
        programDataRoot: "C:\\ProgramData",
      }),
    ).toThrowError(/ProgramData/);
  });

  it("generates independent URL-safe secrets and redacts them from logs", () => {
    // Defect caught: setup could emit weak/reserved-character credentials or leak them through diagnostics.
    let fill = 1;
    const secrets = generateInstallationSecrets((size) => Buffer.alloc(size, fill++));
    expect(secrets.databasePassword).toMatch(/^[a-f0-9]{64}$/);
    expect(secrets.betterAuthSecret).toMatch(/^[a-f0-9]{96}$/);
    expect(secrets.databasePassword).not.toBe(secrets.betterAuthSecret);
    expect(
      redactInstallerText(
        `database=${secrets.databasePassword}; auth=${secrets.betterAuthSecret}`,
        Object.values(secrets),
      ),
    ).toBe("database=[REDACTED]; auth=[REDACTED]");
  });

  it("classifies PostgreSQL 16 only and requires its service and tools", () => {
    // Defect caught: setup could accept an unsupported major or a partial/non-running installation.
    expect(
      classifyPostgresInstallation([
        {
          major: 16,
          binPath: "C:\\Program Files\\PostgreSQL\\16\\bin",
          serviceName: "postgresql-x64-16",
          serviceRunning: true,
          toolsPresent: true,
        },
      ]),
    ).toMatchObject({ status: "installed", major: 16 });
    expect(classifyPostgresInstallation([])).toEqual({ status: "missing" });
    expect(
      classifyPostgresInstallation([
        {
          major: 17,
          binPath: "C:\\Program Files\\PostgreSQL\\17\\bin",
          serviceName: "postgresql-x64-17",
          serviceRunning: true,
          toolsPresent: true,
        },
      ]),
    ).toMatchObject({ status: "unsupported", detectedMajors: [17] });
  });

  it("treats only loopback listeners as safe and never claims an occupied foreign port", () => {
    // Defect caught: setup could bind publicly or kill/hijack an unrelated process on the selected port.
    expect(() =>
      assertLoopbackListeners([{ address: "127.0.0.1" }, { address: "::1" }]),
    ).not.toThrow();
    expect(() => assertLoopbackListeners([{ address: "0.0.0.0" }])).toThrowError(/loopback/i);
    expect(classifyPort([])).toBe("available");
    expect(classifyPort([{ address: "127.0.0.1", owner: "HamdFoodsERP" }])).toBe("owned");
    expect(classifyPort([{ address: "127.0.0.1", owner: "OtherService" }])).toBe("occupied");
  });

  it("constructs ACL and task definitions using absolute installed paths and SYSTEM", () => {
    // Defect caught: config could inherit broad access or a task could depend on PATH, pnpm, or the source checkout.
    expect(buildConfigAclCommand("C:\\ProgramData\\HamdFoodsERP\\config\\.env.production")).toEqual(
      {
        executable: "C:\\Windows\\System32\\icacls.exe",
        args: [
          "C:\\ProgramData\\HamdFoodsERP\\config\\.env.production",
          "/inheritance:r",
          "/grant:r",
          "*S-1-5-18:F",
          "*S-1-5-32-544:F",
        ],
      },
    );
    expect(buildApplicationTaskDefinition(productionOptions)).toMatchObject({
      taskName: "HamdFoodsERP",
      userId: "SYSTEM",
      executable: "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
      workingDirectory: productionOptions.appRoot,
      bundledNode: "C:\\Program Files\\HamdFoodsERP\\runtime\\node\\node.exe",
      environmentFile: "C:\\ProgramData\\HamdFoodsERP\\config\\.env.production",
      startsAtBoot: true,
      restartCount: 3,
    });
  });

  it("builds a daily non-interactive backup task with configured ProgramData logs", () => {
    // Defect caught: automated backups could use an interactive account, overlap, or write outside ProgramData.
    expect(buildBackupTaskDefinition(productionOptions)).toMatchObject({
      taskName: "HamdFoodsERP-Backup",
      userId: "SYSTEM",
      schedule: "02:00",
      overlapPolicy: "ignore-new",
      logPath: "C:\\ProgramData\\HamdFoodsERP\\logs\\backup.log",
    });
  });

  it("distinguishes fresh, repair, and unsafe pre-existing database conflicts", () => {
    // Defect caught: reinstall could rotate secrets or claim an unrelated existing role/database.
    expect(
      createInstallationPlan({
        existingConfig: false,
        existingTask: false,
        databaseExists: false,
        roleExists: false,
      }),
    ).toMatchObject({ mode: "fresh", generateSecrets: true, backupBeforeMigrations: false });
    expect(
      createInstallationPlan({
        existingConfig: true,
        existingTask: true,
        databaseExists: true,
        roleExists: true,
      }),
    ).toMatchObject({ mode: "repair", generateSecrets: false, backupBeforeMigrations: true });
    expect(() =>
      createInstallationPlan({
        existingConfig: false,
        existingTask: false,
        databaseExists: true,
        roleExists: true,
      }),
    ).toThrowError(/refusing/i);
  });

  it("preserves all business data and ProgramData during normal uninstall", () => {
    // Defect caught: normal uninstall could destroy the database, role, backups, config, logs, or state.
    expect(createUninstallPlan(productionOptions)).toEqual({
      removeTasks: ["HamdFoodsERP", "HamdFoodsERP-Backup"],
      removeAppRoot: "C:\\Program Files\\HamdFoodsERP",
      preserve: ["C:\\ProgramData\\HamdFoodsERP", "database:hamd_foods_erp", "role:hamd_erp"],
    });
  });

  it("requires a minimized payload and rejects secrets, source, tests, caches, and installers", () => {
    // Defect caught: packaging could ship credentials, developer state, or third-party installers.
    const valid = [
      "app/server.js",
      "app/.next/static/chunk.js",
      "app/public/sw.js",
      "runtime/node/node.exe",
      "operations/prisma/schema.prisma",
      "operations/prisma.config.mjs",
      "operations/prisma/migrations/001/migration.sql",
      "operations/seed-all.mjs",
      "operations/bootstrap-super-admin.mjs",
      "operations/database-backup.mjs",
      "windows/Backup-HamdFoodsERP.ps1",
      "windows/Run-HamdFoodsERP.ps1",
      "windows/Setup-HamdFoodsERP.ps1",
      "package.json",
    ];
    expect(() => validatePayloadFiles(valid)).not.toThrow();
    for (const forbidden of [
      "app/.env.production",
      ".git/config",
      "src/server/env.test.ts",
      "playwright-report/index.html",
      "postgresql-16-installer.exe",
      "node-v24.11.1-win-x64.zip",
      "backup.dump",
    ])
      expect(() => validatePayloadFiles([...valid, forbidden])).toThrowError(/payload/i);
  });

  it("keeps Docker, inbound firewall rules, and Tailscale changes out of base install", () => {
    // Defect caught: base setup could create public exposure or make optional remote access mandatory.
    expect(installerSecurityCapabilities()).toEqual({
      dockerRequired: false,
      inboundFirewallPorts: [],
      tailscaleOptional: true,
      altersTailscale: false,
      exposesPostgres: false,
    });
  });
});
