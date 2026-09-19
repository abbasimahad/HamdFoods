import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

const commonScript = path.resolve("installer/scripts/Common-HamdFoodsERP.ps1");
const setupScript = path.resolve("installer/scripts/Setup-HamdFoodsERP.ps1");
const recoveryScript = path.resolve("installer/scripts/Account-Recovery-HamdFoodsERP.ps1");
const installerDefinition = path.resolve("installer/HamdFoodsERP.iss");
const windowsIt = process.platform === "win32" ? it : it.skip;

describe("Windows installer PowerShell architecture boundaries", () => {
  windowsIt("keeps recovery credentials off command lines and requires elevation", () => {
    // Defect caught: a recovery password could leak through argv/history or execute without UAC elevation.
    const source = readFileSync(recoveryScript, "utf8");
    expect(source).toMatch(/Read-Host 'New password' -AsSecureString/);
    expect(source).toMatch(/RedirectStandardInput\s*=\s*\$true/);
    expect(source).toMatch(/Start-Process[\s\S]*-Verb RunAs/);
    expect(source).toMatch(/ZeroFreeBSTR/);
    expect(source).toMatch(/--conditions=react-server/);
    expect(source).not.toMatch(/--(?:new-)?password/i);
    expect(source).not.toMatch(/ArgumentList[^\r\n]*(?:password|confirmation)/i);
  });

  windowsIt("keeps the recovery shortcut inside production or drill roots", () => {
    // Defect caught: the isolated installer drill shortcut targeted production ProgramData.
    const source = readFileSync(installerDefinition, "utf8");
    const recoveryShortcut = source
      .split(/\r?\n/)
      .find((line) => line.includes("\\Account Recovery"));
    expect(recoveryShortcut).toContain("{#DrillSwitch}");
    expect(recoveryShortcut).not.toMatch(/password/i);
    expect(readFileSync(recoveryScript, "utf8")).toMatch(/HamdFoodsERP-InstallDrill/);
  });

  windowsIt(
    "resolves native Program Files when invoked by a 32-bit installer host",
    () => {
      // Defect caught: WOW64 setup looked for PostgreSQL under Program Files (x86) and failed before credentials.
      const windowsRoot = process.env.SystemRoot ?? "C:\\Windows";
      const powershell = path.win32.join(
        windowsRoot,
        "SysWOW64",
        "WindowsPowerShell",
        "v1.0",
        "powershell.exe",
      );
      const escapedCommonScript = commonScript.replaceAll("'", "''");
      const escapedSetupScript = setupScript.replaceAll("'", "''");
      const command = [
        "$env:ProgramFiles = 'C:\\Program Files (x86)'",
        "$env:ProgramW6432 = 'C:\\Program Files'",
        `. '${escapedCommonScript}'`,
        "$tokens = $null",
        "$errors = $null",
        `$ast = [Management.Automation.Language.Parser]::ParseFile('${escapedSetupScript}', [ref]$tokens, [ref]$errors)`,
        "$function = $ast.Find({ param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Find-SupportedPostgres' }, $true)",
        ". ([scriptblock]::Create($function.Extent.Text))",
        "$AppRoot = 'C:\\Program Files\\HamdFoodsERP-InstallDrill'",
        "(Find-SupportedPostgres).Bin",
      ].join("; ");
      const result = spawnSync(
        powershell,
        ["-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", command],
        { encoding: "utf8" },
      );

      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout.trim()).toBe("C:\\Program Files\\PostgreSQL\\16\\bin");
    },
    15_000,
  );

  windowsIt(
    "generates cryptographic secrets under the installed Windows PowerShell 5.1 host",
    () => {
      // Defect caught: RandomNumberGenerator.Fill is unavailable in Windows PowerShell 5.1/.NET Framework.
      const windowsRoot = process.env.SystemRoot ?? "C:\\Windows";
      const powershell = path.win32.join(
        windowsRoot,
        "System32",
        "WindowsPowerShell",
        "v1.0",
        "powershell.exe",
      );
      const escapedSetupScript = setupScript.replaceAll("'", "''");
      const command = [
        "$tokens = $null",
        "$errors = $null",
        `$ast = [Management.Automation.Language.Parser]::ParseFile('${escapedSetupScript}', [ref]$tokens, [ref]$errors)`,
        "$functions = $ast.FindAll({ param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -in @('New-RandomHex', 'New-InstallationSecrets') }, $true)",
        "$functions | ForEach-Object { . ([scriptblock]::Create($_.Extent.Text)) }",
        "$secrets = New-InstallationSecrets",
        "$secrets.DatabasePassword",
        "$secrets.AuthSecret",
      ].join("; ");
      const result = spawnSync(
        powershell,
        ["-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", command],
        { encoding: "utf8" },
      );

      expect(result.status, result.stderr).toBe(0);
      const [databasePassword, authSecret] = result.stdout.trim().split(/\r?\n/);
      expect(databasePassword).toMatch(/^[a-f0-9]{64}$/);
      expect(authSecret).toMatch(/^[a-f0-9]{96}$/);
      expect(authSecret).not.toBe(databasePassword);
    },
  );

  windowsIt("records stage failures without writing secret values", () => {
    // Defect caught: post-install failures were reduced to a generic Inno error with no safe stage evidence.
    const temporary = mkdtempSync(path.join(os.tmpdir(), "hamd-installer-log-"));
    const logPath = path.join(temporary, "provisioning.log");
    try {
      const windowsRoot = process.env.SystemRoot ?? "C:\\Windows";
      const powershell = path.win32.join(
        windowsRoot,
        "System32",
        "WindowsPowerShell",
        "v1.0",
        "powershell.exe",
      );
      const escapedCommonScript = commonScript.replaceAll("'", "''");
      const escapedLogPath = logPath.replaceAll("'", "''");
      const command = [
        `. '${escapedCommonScript}'`,
        `$logPath = '${escapedLogPath}'`,
        "$secret = 'credential-sentinel-value'",
        "Write-HamdFoodsProvisioningEvent -Path $logPath -Stage 'PostgreSQLCredentialAcquisition' -Status 'PASS'",
        "try { throw \"password=$secret endpoint=postgresql://postgres:$secret@127.0.0.1/db token=$secret\" } catch { Write-HamdFoodsProvisioningFailure -Path $logPath -Stage 'DatabaseProvisioning' -ErrorRecord $_ -SensitiveValues @($secret) }",
      ].join("; ");
      const result = spawnSync(
        powershell,
        ["-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", command],
        { encoding: "utf8" },
      );

      expect(result.status, result.stderr).toBe(0);
      const log = readFileSync(logPath, "utf8");
      expect(log).toMatch(/^\d{4}-\d{2}-\d{2}T.* \[PostgreSQLCredentialAcquisition\] PASS$/m);
      expect(log).toMatch(
        /^\d{4}-\d{2}-\d{2}T.* \[DatabaseProvisioning\] FAIL ExitCode=1 ErrorType=System\.Management\.Automation\.RuntimeException Message=/m,
      );
      expect(log).toContain("[REDACTED]");
      expect(log).not.toContain("credential-sentinel-value");
      expect(log).not.toMatch(/postgresql:\/\/postgres:/);
    } finally {
      rmSync(temporary, { recursive: true, force: true });
    }
  });

  windowsIt(
    "preserves exact native argv boundaries and child exit codes without leaking output",
    () => {
      // Defects caught: Start-Process flattened argv at spaces and raw child output bypassed redaction.
      const temporary = mkdtempSync(path.join(os.tmpdir(), "hamd Program Files "));
      const appRoot = path.join(temporary, "HamdFoodsERP-InstallDrill");
      const runtimeRoot = path.join(appRoot, "runtime", "node");
      const operationsRoot = path.join(appRoot, "operations");
      const probePath = path.join(operationsRoot, "argv probe.js");
      const logPath = path.join(temporary, "provisioning.log");
      const secret = "bootstrap-password-sentinel";
      try {
        mkdirSync(runtimeRoot, { recursive: true });
        mkdirSync(operationsRoot, { recursive: true });
        copyFileSync(process.execPath, path.join(runtimeRoot, "node.exe"));
        writeFileSync(
          probePath,
          [
            "const args = process.argv.slice(2);",
            "if (args[0] === '--fail') {",
            "  console.log(`password=${process.env.PROBE_SECRET}`);",
            "  console.error(`postgresql://owner:${process.env.PROBE_SECRET}@127.0.0.1/db token=${process.env.PROBE_SECRET}`);",
            "  process.exit(37);",
            "}",
            "console.log(JSON.stringify(args));",
          ].join("\n"),
        );

        const windowsRoot = process.env.SystemRoot ?? "C:\\Windows";
        const powershell = path.win32.join(
          windowsRoot,
          "System32",
          "WindowsPowerShell",
          "v1.0",
          "powershell.exe",
        );
        const psLiteral = (value: string) => value.replaceAll("'", "''");
        const expected = [
          "C:\\Program Files\\HamdFoodsERP-InstallDrill\\operations\\seed.js",
          "value with spaces",
          "--some-flag",
          "ordinary-value",
          'quoted "value" with \\\\ trailing\\',
        ];
        const arrayLiteral = expected.map((value) => `'${psLiteral(value)}'`).join(",");
        const command = [
          `. '${psLiteral(commonScript)}'`,
          `$appRoot = '${psLiteral(appRoot)}'`,
          `$probe = '${psLiteral(probePath)}'`,
          `$env:PROBE_SECRET = '${secret}'`,
          `$success = @(Invoke-HamdFoodsNode -AppRoot $appRoot -Arguments @($probe,${arrayLiteral}) -SensitiveValues @($env:PROBE_SECRET))`,
          "$success | ForEach-Object { Write-Output $_ }",
          "try { Invoke-HamdFoodsNode -AppRoot $appRoot -Arguments @($probe,'--fail') -SensitiveValues @($env:PROBE_SECRET) } catch { Write-HamdFoodsProvisioningFailure -Path '" +
            psLiteral(logPath) +
            "' -Stage 'SeedExecution' -ErrorRecord $_ -SensitiveValues @($env:PROBE_SECRET); Write-Output \"CAUGHT_EXIT=$($_.Exception.Data['ExitCode'])\" }",
        ].join("; ");
        const result = spawnSync(
          powershell,
          ["-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", command],
          { encoding: "utf8" },
        );

        expect(result.status, result.stderr).toBe(0);
        expect(result.stdout).toContain(JSON.stringify(expected));
        expect(result.stdout).toContain("CAUGHT_EXIT=37");
        const allDiagnostics = `${result.stdout}\n${result.stderr}\n${readFileSync(logPath, "utf8")}`;
        expect(allDiagnostics).toContain("[REDACTED]");
        expect(allDiagnostics).toContain("ExitCode=37");
        expect(allDiagnostics).not.toContain(secret);
      } finally {
        rmSync(temporary, { recursive: true, force: true });
      }
    },
  );

  windowsIt("uses environment-only temporary credentials for automated drill bootstrap", () => {
    // Defect caught: the approved unattended InstallDrill recovery stopped at Read-Host for SUPER_ADMIN input.
    const windowsRoot = process.env.SystemRoot ?? "C:\\Windows";
    const powershell = path.win32.join(
      windowsRoot,
      "System32",
      "WindowsPowerShell",
      "v1.0",
      "powershell.exe",
    );
    const psLiteral = (value: string) => value.replaceAll("'", "''");
    const command = [
      "$tokens = $null",
      "$errors = $null",
      `$ast = [Management.Automation.Language.Parser]::ParseFile('${psLiteral(setupScript)}', [ref]$tokens, [ref]$errors)`,
      "$functions = $ast.FindAll({ param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Invoke-AdminBootstrap' }, $true)",
      "$functions | ForEach-Object { . ([scriptblock]::Create($_.Extent.Text)) }",
      "$Drill = $true",
      "$AppRoot = 'C:\\Program Files\\HamdFoodsERP-InstallDrill'",
      "$env:HAMDFOODS_AUTOMATED_INSTALL_DRILL = '1'",
      "$env:HAMDFOODS_DRILL_ADMIN_NAME = 'Installer Drill Administrator'",
      "$env:HAMDFOODS_DRILL_ADMIN_EMAIL = 'installer-drill-admin@hamdfoods.invalid'",
      "$env:HAMDFOODS_DRILL_ADMIN_PASSWORD = 'temporary-password-sentinel'",
      "function Get-HamdFoodsSensitiveValues { @($env:BOOTSTRAP_ADMIN_PASSWORD) }",
      "function Invoke-HamdFoodsNode { if ($env:BOOTSTRAP_ADMIN_NAME -ne 'Installer Drill Administrator' -or $env:BOOTSTRAP_ADMIN_EMAIL -ne 'installer-drill-admin@hamdfoods.invalid' -or $env:BOOTSTRAP_ADMIN_PASSWORD -ne 'temporary-password-sentinel') { throw 'wrong bootstrap environment' }; Write-Output 'BOOTSTRAP_CALLED' }",
      "Invoke-AdminBootstrap",
      "if (Test-Path Env:BOOTSTRAP_ADMIN_PASSWORD) { throw 'bootstrap password was not cleared' }",
    ].join("; ");
    const result = spawnSync(
      powershell,
      [
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        command,
      ],
      { encoding: "utf8" },
    );

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout.trim()).toBe("BOOTSTRAP_CALLED");
    expect(`${result.stdout}\n${result.stderr}`).not.toContain("temporary-password-sentinel");
  });

  function extractGetPostgresAdministratorPasswordCommand(body: string[]) {
    const psLiteral = (value: string) => value.replaceAll("'", "''");
    return [
      "$tokens = $null",
      "$errors = $null",
      `$ast = [Management.Automation.Language.Parser]::ParseFile('${psLiteral(setupScript)}', [ref]$tokens, [ref]$errors)`,
      "$function = $ast.Find({ param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Get-PostgresAdministratorPassword' }, $true)",
      "if ($null -eq $function) { Write-Output 'PROMPT_REQUIRED'; exit 0 }",
      ". ([scriptblock]::Create($function.Extent.Text))",
      "$Drill = $true",
      "function Get-Credential { throw 'interactive credential prompt was called' }",
      ...body,
    ].join("; ");
  }

  function runPowerShellCommand(command: string) {
    const windowsRoot = process.env.SystemRoot ?? "C:\\Windows";
    const powershell = path.win32.join(
      windowsRoot,
      "System32",
      "WindowsPowerShell",
      "v1.0",
      "powershell.exe",
    );
    return spawnSync(
      powershell,
      [
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        command,
      ],
      { encoding: "utf8" },
    );
  }

  windowsIt(
    "returns the operator-supplied real credential for an automated drill, never a passwordless/trust fallback",
    () => {
      // Defect caught: the automated drill unconditionally returned an empty
      // password, assuming PostgreSQL trust authentication on loopback. The
      // real machine correctly requires SCRAM, so this always failed outside
      // an environment specially configured to trust local connections.
      const command = extractGetPostgresAdministratorPasswordCommand([
        "$env:HAMDFOODS_AUTOMATED_INSTALL_DRILL = '1'",
        "$env:HAMDFOODS_DRILL_POSTGRES_ADMIN_PASSWORD = 'test-only-scram-credential-sentinel'",
        "try { Get-PostgresAdministratorPassword } finally { Remove-Item Env:HAMDFOODS_DRILL_POSTGRES_ADMIN_PASSWORD -ErrorAction SilentlyContinue }",
      ]);
      const result = runPowerShellCommand(command);

      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout.trim()).toBe("test-only-scram-credential-sentinel");
      expect(`${result.stdout}\n${result.stderr}`).not.toContain("interactive credential prompt");
    },
  );

  windowsIt(
    "fails closed without a trust/empty fallback when the automated drill credential is missing",
    () => {
      const command = extractGetPostgresAdministratorPasswordCommand([
        "$env:HAMDFOODS_AUTOMATED_INSTALL_DRILL = '1'",
        "Remove-Item Env:HAMDFOODS_DRILL_POSTGRES_ADMIN_PASSWORD -ErrorAction SilentlyContinue",
        "Get-PostgresAdministratorPassword",
      ]);
      const result = runPowerShellCommand(command);

      expect(result.status).not.toBe(0);
      expect(`${result.stdout}\n${result.stderr}`).toContain(
        "HAMDFOODS_DRILL_POSTGRES_ADMIN_PASSWORD",
      );
      expect(`${result.stdout}\n${result.stderr}`).not.toContain("interactive credential prompt");
    },
  );

  windowsIt("forbids an implicit PostgreSQL password prompt during provisioning", () => {
    // Defect caught: an absent password could make hidden unattended psql wait for interactive input.
    const windowsRoot = process.env.SystemRoot ?? "C:\\Windows";
    const powershell = path.win32.join(
      windowsRoot,
      "System32",
      "WindowsPowerShell",
      "v1.0",
      "powershell.exe",
    );
    const psLiteral = (value: string) => value.replaceAll("'", "''");
    const command = [
      "$tokens = $null",
      "$errors = $null",
      `$ast = [Management.Automation.Language.Parser]::ParseFile('${psLiteral(setupScript)}', [ref]$tokens, [ref]$errors)`,
      "$function = $ast.Find({ param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Invoke-Psql' }, $true)",
      ". ([scriptblock]::Create($function.Extent.Text))",
      "function Invoke-HamdFoodsNativeProcess { param($FilePath,$WorkingDirectory,$Arguments,$SensitiveValues); if ('--no-password' -in $Arguments) { [pscustomobject]@{ SafeStdOut = 'PASSWORD_PROMPT_DISABLED' } } else { [pscustomobject]@{ SafeStdOut = 'PROMPT_ALLOWED' } } }",
      "$postgres = @{ Psql = 'C:\\Program Files\\PostgreSQL\\16\\bin\\psql.exe'; Bin = 'C:\\Program Files\\PostgreSQL\\16\\bin' }",
      "Invoke-Psql -Postgres $postgres -Password '' -Command 'SELECT 1'",
    ].join("; ");
    const result = spawnSync(
      powershell,
      [
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        command,
      ],
      { encoding: "utf8" },
    );

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout.trim()).toBe("PASSWORD_PROMPT_DISABLED");
  });

  windowsIt("rejects malformed recovery flags and provisioning stages", () => {
    // Defect caught: truthy JSON strings or unknown stages could make setup skip required recovery work.
    const windowsRoot = process.env.SystemRoot ?? "C:\\Windows";
    const powershell = path.win32.join(
      windowsRoot,
      "System32",
      "WindowsPowerShell",
      "v1.0",
      "powershell.exe",
    );
    const psLiteral = (value: string) => value.replaceAll("'", "''");
    const command = [
      "$tokens = $null",
      "$errors = $null",
      `$ast = [Management.Automation.Language.Parser]::ParseFile('${psLiteral(setupScript)}', [ref]$tokens, [ref]$errors)`,
      "$function = $ast.Find({ param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Assert-HamdFoodsProvisioningState' }, $true)",
      ". ([scriptblock]::Create($function.Extent.Text))",
      "$installationId = 'EEEA3D20-202A-4B36-8145-41EC53AECA63'",
      "$AppRoot = 'C:\\Program Files\\HamdFoodsERP-InstallDrill'",
      "$DataRoot = 'C:\\ProgramData\\HamdFoodsERP-InstallDrill'",
      "$DatabaseName = 'hamd_foods_erp_installer_drill'",
      "$RoleName = 'hamd_erp_installer_drill'",
      "$state = [pscustomobject]@{ SchemaVersion = 1; InstallationId = $installationId; ApplicationVersion = '0.1.0'; AppRoot = $AppRoot; DataRoot = $DataRoot; DatabaseName = $DatabaseName; RoleName = $RoleName; ResourcesCreated = [pscustomobject]@{ Database = 'false'; Role = 'true' }; CompletedStages = @('ConfigurationWrite','UnknownStage'); ProvisioningComplete = 'false' }",
      "$rejected = $false",
      "try { Assert-HamdFoodsProvisioningState -State $state -RequireResources } catch { $rejected = $true }",
      "if (-not $rejected) { throw 'malformed recovery state was accepted' }",
      "$state.ResourcesCreated.Database = $true",
      "$state.ResourcesCreated.Role = $true",
      "$state.CompletedStages = @('ConfigurationWrite','MigrationDeployment')",
      "$state.ProvisioningComplete = $true",
      "$rejected = $false",
      "try { Assert-HamdFoodsProvisioningState -State $state -RequireResources } catch { $rejected = $true }",
      "if (-not $rejected) { throw 'incomplete state was accepted as complete' }",
    ].join("; ");
    const result = spawnSync(
      powershell,
      ["-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", command],
      { encoding: "utf8" },
    );

    expect(result.status, result.stderr).toBe(0);
  });

  windowsIt(
    "terminates only the identity-checked installed runtime before unregistering tasks",
    () => {
      // Defect caught: Task Scheduler stopped its PowerShell launcher but left the installed Node child listening.
      const windowsRoot = process.env.SystemRoot ?? "C:\\Windows";
      const powershell = path.win32.join(
        windowsRoot,
        "System32",
        "WindowsPowerShell",
        "v1.0",
        "powershell.exe",
      );
      const psLiteral = (value: string) => value.replaceAll("'", "''");
      const command = [
        "$tokens = $null",
        "$errors = $null",
        `$ast = [Management.Automation.Language.Parser]::ParseFile('${psLiteral(setupScript)}', [ref]$tokens, [ref]$errors)`,
        "$functions = $ast.FindAll({ param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -in @('Stop-HamdFoodsManagedRuntime','Remove-HamdFoodsScheduledTasks') }, $true)",
        "$functions | ForEach-Object { . ([scriptblock]::Create($_.Extent.Text)) }",
        "$AppRoot = 'C:\\Program Files\\HamdFoodsERP-InstallDrill'",
        "$Port = 3200",
        "$TaskName = 'HamdFoodsERP-InstallDrill'",
        "$BackupTaskName = 'HamdFoodsERP-InstallDrill-Backup'",
        "$events = [Collections.Generic.List[string]]::new()",
        "$listenerReads = 0",
        "function Stop-ScheduledTask { [CmdletBinding()] param([string]$TaskName); $events.Add('stop:' + $TaskName) }",
        "function Get-NetTCPConnection { [CmdletBinding()] param([string]$State,[int]$LocalPort); $script:listenerReads += 1; if ($script:listenerReads -eq 1) { [pscustomobject]@{ LocalAddress = '127.0.0.1'; LocalPort = 3200; OwningProcess = 4242 } } }",
        "function Get-Process { [CmdletBinding()] param([int]$Id); [pscustomobject]@{ Id = $Id; ProcessName = 'node'; Path = 'C:\\Program Files\\HamdFoodsERP-InstallDrill\\runtime\\node\\node.exe' } }",
        "function Start-Process { [CmdletBinding()] param([string]$FilePath,[object[]]$ArgumentList,[switch]$Wait,[switch]$PassThru,[string]$WindowStyle); $events.Add('taskkill:' + ($ArgumentList -join ':')); [pscustomobject]@{ ExitCode = 0 } }",
        "function Start-Sleep { param([int]$Milliseconds,[int]$Seconds); if ($Seconds) { $events.Add('sleep:' + $Seconds) } }",
        "function Unregister-ScheduledTask { [CmdletBinding()] param([string]$TaskName,[switch]$Confirm); $events.Add('unregister:' + $TaskName) }",
        "Remove-HamdFoodsScheduledTasks",
        "$events -join ','",
      ].join("; ");
      const result = spawnSync(
        powershell,
        ["-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", command],
        { encoding: "utf8" },
      );

      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout.trim()).toBe(
        "stop:HamdFoodsERP-InstallDrill,sleep:2,taskkill:/PID:4242:/T:/F,stop:HamdFoodsERP-InstallDrill-Backup,stop:HamdFoodsERP-InstallDrill-Update,unregister:HamdFoodsERP-InstallDrill,unregister:HamdFoodsERP-InstallDrill-Backup,unregister:HamdFoodsERP-InstallDrill-Update",
      );
    },
  );

  windowsIt("uses exact managed-runtime termination for a repair listener", () => {
    // Defect caught: repair stopped only the task launcher and rejected its orphaned Node child as occupied.
    const windowsRoot = process.env.SystemRoot ?? "C:\\Windows";
    const powershell = path.win32.join(
      windowsRoot,
      "System32",
      "WindowsPowerShell",
      "v1.0",
      "powershell.exe",
    );
    const psLiteral = (value: string) => value.replaceAll("'", "''");
    const command = [
      "$tokens = $null",
      "$errors = $null",
      `$ast = [Management.Automation.Language.Parser]::ParseFile('${psLiteral(setupScript)}', [ref]$tokens, [ref]$errors)`,
      "$function = $ast.FindAll({ param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Assert-PortAvailableOrOwned' }, $true) | Select-Object -First 1",
      ". ([scriptblock]::Create($function.Extent.Text))",
      "$events = [Collections.Generic.List[string]]::new()",
      "function Get-NetTCPConnection { [CmdletBinding()] param([string]$State,[int]$LocalPort); [pscustomobject]@{ LocalAddress = '127.0.0.1'; LocalPort = 3200; OwningProcess = 4242 } }",
      "function Get-ScheduledTask { [CmdletBinding()] param([string]$TaskName); [pscustomobject]@{ TaskName = $TaskName } }",
      "function Stop-HamdFoodsManagedRuntime { $events.Add('stop-managed-runtime') }",
      "Assert-PortAvailableOrOwned -Port 3200 -TaskName 'HamdFoodsERP-InstallDrill'",
      "$events -join ','",
    ].join("; ");
    const result = spawnSync(
      powershell,
      ["-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", command],
      { encoding: "utf8" },
    );

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout.trim()).toBe("stop-managed-runtime");
  });

  it("orders credential, provisioning, and config stages and propagates failure to Inno", () => {
    // Defect caught: a post-credential failure could be unobservable or return success to the installer shell.
    const setup = readFileSync(setupScript, "utf8");
    const inno = readFileSync(path.resolve("installer/HamdFoodsERP.iss"), "utf8");
    const acquisition = setup.indexOf("$stage = 'PostgreSQLCredentialAcquisition'");
    const credential = setup.indexOf("$postgresPassword = Get-PostgresAdministratorPassword");
    const validation = setup.indexOf("$stage = 'PostgreSQLCredentialValidation'");
    const resources = setup.indexOf("$stage = 'DatabaseProvisioning'");
    const config = setup.indexOf("$stage = 'ConfigurationWrite'");

    expect(acquisition).toBeGreaterThan(-1);
    expect(credential).toBeGreaterThan(acquisition);
    expect(validation).toBeGreaterThan(credential);
    expect(resources).toBeGreaterThan(validation);
    expect(config).toBeGreaterThan(resources);
    expect(setup).toContain("Write-HamdFoodsProvisioningFailure");
    expect(setup).toMatch(/catch \{[\s\S]*exit 1[\s\S]*\}\s*$/);
    expect(inno).toContain("if ResultCode <> 0 then");
    expect(inno).toContain("provisioning.log");
  });

  it("stops an installed runtime before Inno overwrites files during repair", () => {
    // Defect caught: the post-install repair hook ran too late to replace files held by the live Node runtime.
    const setup = readFileSync(setupScript, "utf8");
    const inno = readFileSync(path.resolve("installer/HamdFoodsERP.iss"), "utf8");
    expect(setup).toContain("'StopRuntime'");
    expect(setup).toMatch(/if \(\$Mode -eq 'StopRuntime'\)[\s\S]*Stop-HamdFoodsManagedRuntime/);
    expect(inno).toContain("function PrepareToInstall(var NeedsRestart: Boolean): String;");
    expect(inno).toContain("-Mode StopRuntime");
    expect(inno).toContain("{sysnative}\\WindowsPowerShell\\v1.0\\powershell.exe");
    expect(inno).not.toContain("{sys}\\WindowsPowerShell\\v1.0\\powershell.exe");
    expect(inno.indexOf("function PrepareToInstall")).toBeLessThan(
      inno.indexOf("procedure CurStepChanged"),
    );
  });

  it("persists explicit ownership stages and resumes bootstrap after a partial install", () => {
    // Defect caught: the presence of config alone selected repair and permanently skipped bootstrap.
    const setup = readFileSync(setupScript, "utf8");
    const common = readFileSync(commonScript, "utf8");
    expect(setup).toContain("provisioning-state.json");
    expect(setup).toContain("InstallationId = $installationId");
    expect(setup).toContain("ResourcesCreated");
    expect(setup).toContain("CompletedStages");
    expect(setup).toContain("ProvisioningComplete");
    expect(setup).toMatch(
      /if \(-not \(Test-HamdFoodsProvisioningStage -State \$managedState -Stage 'AdministratorBootstrap'\)\)/,
    );
    expect(setup).toContain("Import-HamdFoodsLegacyProvisioningState");
    expect(setup).toMatch(/lacks complete legacy installer provenance/i);
    expect(common).not.toContain("Start-Process -FilePath $node -ArgumentList");
    expect(common).not.toContain("[Console]::Out.Write");
    expect(common).not.toContain("[Console]::Error.Write");
  });
});
