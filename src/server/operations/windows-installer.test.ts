import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  assertLoopbackListeners,
  buildApplicationTaskDefinition,
  buildBackupTaskDefinition,
  buildConfigAclCommand,
  classifyPort,
  classifyPostgresInstallation,
  classifyInstallerRecovery,
  createInstallationPlan,
  createUninstallPlan,
  generateInstallationSecrets,
  installerSecurityCapabilities,
  redactInstallerText,
  resolveProductionEnvFile,
  runInstallerDrillWorkflow,
  validateInstallerOptions,
  validatePayloadFiles,
  verifyInstallerDrillAuthentication,
  type InstallerOptions,
  type PostgresCandidate,
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

function postgresCandidate(
  major: number,
  overrides: Partial<PostgresCandidate> = {},
): PostgresCandidate {
  return {
    major,
    installationRoot: `C:\\Program Files\\PostgreSQL\\${major}`,
    binPath: `C:\\Program Files\\PostgreSQL\\${major}\\bin`,
    serviceName: `postgresql-x64-${major}`,
    serviceRegistered: true,
    serviceRunning: true,
    serverBinaryPresent: true,
    toolsPresent: true,
    dataDirectoryPresent: true,
    hamdFoodsManaged: false,
    ...overrides,
  };
}

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
    expect(classifyPostgresInstallation([postgresCandidate(16)])).toMatchObject({
      status: "installed",
      major: 16,
      legacyArtifacts: [],
    });
    expect(classifyPostgresInstallation([])).toEqual({ status: "missing", legacyArtifacts: [] });
    expect(
      classifyPostgresInstallation([postgresCandidate(16, { serviceRunning: false })]),
    ).toMatchObject({ status: "unsupported", detectedMajors: [16] });
    expect(classifyPostgresInstallation([postgresCandidate(17)])).toMatchObject({
      status: "unsupported",
      detectedMajors: [17],
    });
  });

  it("selects valid PostgreSQL 16 and reports an orphaned data-only 17 cluster as ignored legacy state", () => {
    // Defect caught: a higher incomplete data directory could block or override the supported running service.
    const result = classifyPostgresInstallation([
      postgresCandidate(17, {
        serviceRegistered: false,
        serviceRunning: false,
        serverBinaryPresent: false,
        toolsPresent: false,
      }),
      postgresCandidate(16),
    ]);
    expect(result).toMatchObject({ status: "installed", major: 16 });
    expect(result.legacyArtifacts).toEqual([
      {
        major: 17,
        rootPath: "C:\\Program Files\\PostgreSQL\\17",
        classification: "unmanaged",
        disposition: "ignore",
      },
    ]);
  });

  it("does not treat a data-only PostgreSQL 17 directory as usable or request a mutation", () => {
    // Defect caught: discovery could select or attempt to start an orphaned PEM data directory.
    expect(
      classifyPostgresInstallation([
        postgresCandidate(17, {
          serviceRegistered: false,
          serviceRunning: false,
          serverBinaryPresent: false,
          toolsPresent: false,
        }),
      ]),
    ).toEqual({
      status: "missing",
      legacyArtifacts: [
        {
          major: 17,
          rootPath: "C:\\Program Files\\PostgreSQL\\17",
          classification: "unmanaged",
          disposition: "ignore",
        },
      ],
    });
  });

  it("prefers an explicitly validated managed PostgreSQL 16 candidate", () => {
    // Defect caught: selection order could ignore the known HamdFoods installation and choose another folder.
    const managed = postgresCandidate(16, {
      installationRoot: "C:\\Program Files\\PostgreSQL\\16-managed",
      binPath: "C:\\Program Files\\PostgreSQL\\16-managed\\bin",
      serviceName: "hamd-postgresql-16",
      hamdFoodsManaged: true,
    });
    const generic = postgresCandidate(16);
    expect(classifyPostgresInstallation([generic, managed])).toMatchObject({
      status: "installed",
      installationRoot: managed.installationRoot,
      serviceName: managed.serviceName,
    });
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
        installerOwned: true,
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

  it("distinguishes fresh, owned partial, healthy repair, and foreign resources by provenance", () => {
    // Defect caught: config existence alone made an incomplete bootstrap permanently unreachable.
    expect(
      classifyInstallerRecovery({
        configExists: false,
        databaseExists: false,
        roleExists: false,
        state: undefined,
      }),
    ).toMatchObject({ mode: "fresh", nextStage: "PostgreSQLCredentialAcquisition" });
    expect(
      classifyInstallerRecovery({
        configExists: true,
        databaseExists: true,
        roleExists: true,
        state: {
          owned: true,
          completedStages: ["ConfigurationWrite", "MigrationDeployment", "SeedExecution"],
          provisioningComplete: false,
        },
      }),
    ).toMatchObject({ mode: "resume", nextStage: "AdministratorBootstrap" });
    expect(
      classifyInstallerRecovery({
        configExists: true,
        databaseExists: true,
        roleExists: true,
        state: {
          owned: true,
          completedStages: [
            "ConfigurationWrite",
            "MigrationDeployment",
            "SeedExecution",
            "AdministratorBootstrap",
            "TaskRegistration",
            "RuntimeStartup",
          ],
          provisioningComplete: true,
        },
      }),
    ).toMatchObject({ mode: "repair", bootstrapRequired: false });
    expect(() =>
      classifyInstallerRecovery({
        configExists: true,
        databaseExists: true,
        roleExists: true,
        state: undefined,
      }),
    ).toThrowError(/ownership|provenance/i);
  });

  it("preserves all business data and ProgramData during normal uninstall", () => {
    // Defect caught: normal uninstall could destroy the database, role, backups, config, logs, or state.
    expect(createUninstallPlan(productionOptions)).toEqual({
      removeTasks: ["HamdFoodsERP", "HamdFoodsERP-Backup"],
      removeAppRoot: "C:\\Program Files\\HamdFoodsERP",
      preserve: ["C:\\ProgramData\\HamdFoodsERP", "database:hamd_foods_erp", "role:hamd_erp"],
    });
    expect(createUninstallPlan(drillOptions)).toEqual({
      removeTasks: ["HamdFoodsERP-InstallDrill", "HamdFoodsERP-InstallDrill-Backup"],
      removeAppRoot: "C:\\Program Files\\HamdFoodsERP-InstallDrill",
      preserve: [
        "C:\\ProgramData\\HamdFoodsERP-InstallDrill",
        "database:hamd_foods_erp_installer_drill",
        "role:hamd_erp_installer_drill",
      ],
    });
  });

  it("sends the exact trusted origin for automated drill authentication posts", async () => {
    // Defect caught: Node fetch omitted Origin, so Better Auth rejected sign-in with 403 before checking credentials.
    const origin = "http://127.0.0.1:3200";
    const seen: Array<{ url: string; origin: string | null }> = [];
    let signedIn = false;
    const request = async (resource: string | URL | Request, init?: RequestInit) => {
      const url = resource.toString();
      const requestOrigin = new Headers(init?.headers).get("origin");
      seen.push({ url, origin: requestOrigin });
      if (url.endsWith("/api/health")) return new Response(null, { status: 200 });
      if (url.endsWith("/api/auth/sign-in/email")) {
        signedIn = requestOrigin === origin;
        return new Response(null, {
          status: signedIn ? 200 : 403,
          headers: { "set-cookie": "drill-session=test; Path=/; HttpOnly" },
        });
      }
      if (url.endsWith("/dashboard")) return new Response(null, { status: signedIn ? 200 : 307 });
      if (url.endsWith("/administration/users"))
        return new Response(null, { status: signedIn ? 200 : 307 });
      if (url.endsWith("/api/auth/sign-out")) {
        signedIn = false;
        const contentType = new Headers(init?.headers).get("content-type");
        return new Response(null, {
          status:
            requestOrigin === origin && contentType === "application/json" && init?.body === "{}"
              ? 200
              : 400,
        });
      }
      return new Response(null, { status: requestOrigin === origin ? 400 : 403 });
    };

    await expect(
      verifyInstallerDrillAuthentication({
        origin,
        email: "installer-drill-admin@hamdfoods.invalid",
        password: "test-only-drill-password",
        request,
      }),
    ).resolves.toBeUndefined();
    expect(seen).toEqual([
      { url: `${origin}/api/health`, origin: null },
      { url: `${origin}/api/health`, origin: null },
      { url: `${origin}/api/auth/sign-in/email`, origin },
      { url: `${origin}/dashboard`, origin: null },
      { url: `${origin}/administration/users`, origin: null },
      { url: `${origin}/api/auth/sign-up/email`, origin },
      { url: `${origin}/api/auth/sign-out`, origin },
      { url: `${origin}/dashboard`, origin: null },
    ]);
  });

  it("retries a transient transport failure after the drill runtime restarts", async () => {
    let healthAttempts = 0;
    let signInAttempts = 0;
    let signedIn = false;
    const request = async (resource: string | URL | Request) => {
      const url = resource.toString();
      if (url.endsWith("/api/health")) {
        healthAttempts += 1;
        if (healthAttempts === 1) throw new TypeError("fetch failed");
        return new Response(null, { status: 200 });
      }
      if (url.endsWith("/api/auth/sign-in/email")) {
        signInAttempts += 1;
        signedIn = true;
        return new Response(null, {
          status: 200,
          headers: { "set-cookie": "drill-session=test; Path=/; HttpOnly" },
        });
      }
      if (url.endsWith("/dashboard")) return new Response(null, { status: signedIn ? 200 : 307 });
      if (url.endsWith("/administration/users")) return new Response(null, { status: 200 });
      if (url.endsWith("/api/auth/sign-up/email")) return new Response(null, { status: 400 });
      if (url.endsWith("/api/auth/sign-out")) {
        signedIn = false;
        return new Response(null, { status: 200 });
      }
      return new Response(null, { status: 404 });
    };

    await expect(
      verifyInstallerDrillAuthentication({
        origin: "http://127.0.0.1:3200",
        email: "installer-drill-admin@hamdfoods.invalid",
        password: "test-only-drill-password",
        request,
      }),
    ).resolves.toBeUndefined();
    expect(healthAttempts).toBe(3);
    expect(signInAttempts).toBe(1);
  });

  it("runs backup and restart before repair and uninstalls only after every auth check passes", async () => {
    // Defect caught: installer:drill left its Program Files payload and SYSTEM tasks running after successful checks.
    const events: string[] = [];
    await runInstallerDrillWorkflow({
      install(stage) {
        events.push(stage);
      },
      async authenticate() {
        events.push("authenticate");
      },
      backup() {
        events.push("backup");
      },
      restart() {
        events.push("restart");
      },
      uninstall() {
        events.push("uninstall");
      },
    });

    expect(events).toEqual([
      "recovery",
      "authenticate",
      "backup",
      "restart",
      "authenticate",
      "repair",
      "authenticate",
      "uninstall",
    ]);
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
      "operations/node_modules/example/index.js.map",
      "operations/node_modules/example/index.d.ts",
      "operations/node_modules/example/README.md",
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
