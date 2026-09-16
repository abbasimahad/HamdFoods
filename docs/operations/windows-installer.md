# Native Windows installer

Phase 32 packages Hamd Foods ERP as an elevated Inno Setup installation. A factory PC runs the installed product from `C:\Program Files\HamdFoodsERP`; it does not need Git, source code, Node, Corepack, pnpm, npm, Docker, Developer Mode, or VS Code. Mutable state and secrets live under `C:\ProgramData\HamdFoodsERP`.

## Release-engineering prerequisites

Use 64-bit Windows, an elevated shell, the repository-pinned pnpm, Node 24.11.1, a proven `production:build`, and Inno Setup 7 from the [official download](https://jrsoftware.org/isdl.php). Inno Setup is not downloaded automatically. Compiler discovery checks a validated explicit `INNO_SETUP_COMPILER` override first, followed deterministically by standalone Inno Setup 7 under 64-bit Program Files, 32-bit Program Files, and `%LOCALAPPDATA%\Programs`. Every candidate must be an absolute regular `ISCC.exe` file that successfully reports a compatible 7.x version. Discovery never searches PATH, IDE directories, `node_modules`, temporary/download directories, repositories, or the wider filesystem.

The build downloads `node-v24.11.1-win-x64.zip` only from the official Node distribution and verifies the pinned SHA-256 before copying `node.exe` into the payload. The archive remains in ignored `.installer-cache`; install time is offline for Node. `installer:prepare` stages the minimized Next standalone output, generated static/public assets, migration history, targeted production dependency closure, and compiled seed/bootstrap/backup/account-recovery programs. It rejects `.env` files, repository source, tests, backups, logs, certificates, archives, source maps, TypeScript declaration files, package markdown, and generated installer inputs.

```powershell
corepack pnpm production:build
corepack pnpm installer:preflight
corepack pnpm installer:prepare
corepack pnpm installer:verify
corepack pnpm installer:build
```

`installer:preflight` reports only non-secret host facts. The build stops cleanly when Inno Setup is absent. Generated executables go to ignored `installer\output`; without an explicitly configured Inno SignTool name they are labelled `DEVELOPMENT-UNSIGNED`. For a commercial release, configure a trusted signing command in Inno Setup and set `HAMDFOODS_INNO_SIGNTOOL_NAME`. Never put a PFX/P12 file or private key in the repository.

Port 3100 is the production default. If a verified unrelated local service must retain it, release engineering may set `HAMDFOODS_INSTALLER_PORT` to a reviewed free integer port (never 5432) while compiling. The selected port is compiled into the shortcut and protected setup config, which keeps `HOSTNAME=127.0.0.1`, `PORT`, and `BETTER_AUTH_URL` consistent. Do not improvise by editing a customer config after installation or by binding `0.0.0.0`.

An optional official PostgreSQL 16 Windows installer may be supplied at build time through absolute `HAMDFOODS_POSTGRES_INSTALLER` and its separately trusted `HAMDFOODS_POSTGRES_INSTALLER_SHA256`. The packager verifies the checksum and never commits or downloads that executable. Obtain it from the [official EDB Windows distribution](https://www.enterprisedb.com/downloads/postgres-postgresql-downloads). Interactive prerequisite installation is intentional so the operator sets and retains a strong PostgreSQL administrator password; unattended parameters should be approved for a managed factory-image process before use.

## Fresh installation

Run the installer from a local drive. It requires Administrator elevation, supports x64 Windows, offers a desktop shortcut and a daily 02:00 backup task, and always creates a Start Menu link to `http://127.0.0.1:3100`. The setup detects a running PostgreSQL 16 service and its native tools. PostgreSQL discovery resolves the native 64-bit Program Files directory through `ProgramW6432` when setup is hosted by the 32-bit Inno engine; it must not redirect tool discovery to `Program Files (x86)`. Missing PostgreSQL causes the bundled official prerequisite to open when one was deliberately supplied; otherwise setup stops with the exact prerequisite. Another usable PostgreSQL major, missing tools, a non-loopback 5432 listener, or an unrelated port-3100 listener fails closed. An inactive, service-free data-only legacy major is reported by preflight and ignored without modification. Setup never kills an unrelated process or adds inbound firewall rules.

Fresh setup creates only the non-superuser `hamd_erp` role and its `hamd_foods_erp` database. It refuses to claim either name if it already exists without managed configuration. A Windows PowerShell 5.1-compatible cryptographic RNG generates a 32-byte hex database password and 48-byte hex Better Auth secret through `RandomNumberGenerator.Create().GetBytes()` and `BitConverter`; do not use the newer static `RandomNumberGenerator.Fill` or `Convert.ToHexString` APIs in installed scripts. Secrets are never printed or placed on a process command line. PostgreSQL administrator credentials are held only in process memory/`PGPASSWORD` for the command and then cleared; the ACL-protected SQL file is deleted in `finally`.

The resulting layout is:

```text
C:\Program Files\HamdFoodsERP\
  app\                 Next standalone runtime
  runtime\node\        pinned node.exe
  operations\          migrations and bundled operational commands
  windows\             canonical installed setup/task runners

C:\ProgramData\HamdFoodsERP\
  config\.env.production
  logs\installer\
  logs\
  backups\
  state\provisioning-state.json  protected non-secret ownership/stage metadata
```

The data tree and config have inheritance removed and allow only `SYSTEM` and built-in Administrators. Setup fails if it cannot apply and verify that ACL. Config contains loopback host/URLs, the generated secrets, native PostgreSQL tools, and backup retention (`14` newest and `30` days). No bootstrap password is written to it.

Setup applies the committed history with `prisma migrate deploy`, runs the idempotent production seed, and securely prompts for the initial SUPER_ADMIN name, email, password, and confirmation. Bootstrap values exist only as child-process environment values and are removed immediately. Every installed Node operation uses one Windows PowerShell 5.1-compatible native-process wrapper. Its Windows command-line encoder preserves empty values, spaces, quotes, and trailing backslashes; the executable and working directory remain separate absolute fields. It captures both streams asynchronously, sanitizes them before emitting or throwing, and carries the real child exit code into provisioning diagnostics. It does not put credentials on the command line.

The protected state manifest records the fixed installation identity, installed version, exact application/data/database/role identity, installer-created resource flags, completed provisioning stages, and final completion marker. It contains no credentials. Setup registers one `HamdFoodsERP` boot task as `SYSTEM`, with an absolute PowerShell executable, installed runner, installed bundled Node, ProgramData config, ProgramData logs, and restart-on-failure settings. The optional `HamdFoodsERP-Backup` task also runs as `SYSTEM`, ignores overlapping starts, and uses native `pg_dump`. Setup starts the ERP, checks health, creates one backup, and verifies its manifest/checksum before succeeding.

Tailscale is optional. Setup neither installs it nor changes Serve, Funnel, device, route, DNS, or unattended settings. Use the separate [private-access runbook](tailscale-private-access.md) after local installation if remote HTTPS is wanted. PostgreSQL and the ERP ports receive no Windows Firewall inbound rules.

## Local Administrator account recovery

The Start Menu group contains **Account Recovery** beside the ERP shortcut. The shortcut passes only the fixed installed application/data roots (and the non-secret isolated-drill marker in a drill build) to `Account-Recovery-HamdFoodsERP.ps1`; it contains no email, password, token, or database credential. The wrapper requests UAC elevation when needed, validates that the resolved paths exactly match either the production or isolated-drill roots, imports the protected configuration, and starts the compiled `operations\account-recovery.mjs` with bundled Node. Git, global Node, pnpm, tsx, TypeScript, Docker, and source code are not required on the customer PC.

The compiled program independently fails closed unless `whoami /groups` proves both built-in Administrators membership and high integrity. It has no HTTP route and accepts no command-line arguments. Account discovery returns only display name, login email, roles, and Active status for an active SUPER_ADMIN or active account with `users.manage`. The operator may change login email, reset password, or change both. Passwords are entered twice with `Read-Host -AsSecureString`, briefly converted in process memory, transferred only through redirected standard input, and cleared from wrapper variables after use. A successful recovery preserves roles/status, revokes all sessions, and writes a non-secret `LOCAL_ACCOUNT_RECOVERY` audit event. There is no master password.

## Repair and same-version reinstall

The stable Inno AppId detects the existing product. Setup, rather than config existence alone, classifies the state as fresh, installer-owned partial recovery, completed repair, or foreign conflict. A matching protected state manifest is authoritative. A one-time transition for the preserved third-drill partial state requires the exact protected config plus protected Phase 32 provisioning evidence proving database creation, config writing, and migration deployment; it converts that evidence into the manifest. Any missing or mismatched identity, ACL, config, resource marker, or provenance fails closed instead of claiming a database or role.

An installer-owned partial run preserves its config and secrets and resumes idempotently from its first incomplete migration, seed, SUPER_ADMIN, task, or runtime stage. Thus a failure after migrations but before bootstrap reaches the bootstrap prompt on retry. A completed installation enters repair: it creates and verifies a backup before migrations, deploys pending migrations, reruns the idempotent seed, skips already completed initial bootstrap, and reconciles the canonical task. Neither path rotates credentials, drops data, resets Prisma, or overwrites the existing role/database. Port conflicts still fail closed.

Application logs are under `ProgramData\HamdFoodsERP\logs`; Inno's setup log is shown by the installer. Installed provisioning appends timestamped stage `PASS`/`FAIL` records with sanitized exception type/message and a safe exit code to `logs\installer\provisioning.log`. The log is created inside the protected ProgramData tree before PostgreSQL discovery so a post-install failure is not reduced to Inno's generic error. Diagnostic sanitization removes supplied sensitive values, URL user information, password/secret/token assignments, long hexadecimal secrets, and line breaks. Logs must never contain database URLs with credentials, database passwords, Better Auth secrets, PostgreSQL administrator credentials, or admin passwords.

The isolated drill history includes five diagnosed attempts: the first used WOW64 `Program Files (x86)` PostgreSQL discovery; the second used .NET APIs absent from Windows PowerShell 5.1; the third reached installed migration execution but `Start-Process -ArgumentList` collapsed arguments under paths containing spaces; the fourth safely completed backup, seed, SUPER_ADMIN bootstrap, task registration, loopback health, and initial backup verification, but its external Node login check omitted the exact trusted `Origin` header.

The fifth live drill executed on September 5, 2026, from an elevated context and fully passed the complete end-to-end sequence: fresh install on port 3200, loopback health, exact-Origin Better Auth authentication (`http://127.0.0.1:3200`), SUPER_ADMIN authorization (`/administration/users`), automated task backup creation/verification, process-tree runtime restart, same-version repair/reinstall with idempotent seed rerun, post-repair authentication, and safe uninstall. Safe uninstall removed application files (`C:\Program Files\HamdFoodsERP-InstallDrill`) and Scheduled Tasks while preserving persistent customer data (`C:\ProgramData\HamdFoodsERP-InstallDrill`, database `hamd_foods_erp_installer_drill`, database role `hamd_erp_installer_drill`, state, and 3 verified backup dumps). PostgreSQL 17 remained untouched throughout.

## Uninstall and failure safety

Normal uninstall removes installer-owned Program Files content and shortcuts and first stops then unregisters only `HamdFoodsERP` and `HamdFoodsERP-Backup`. It deliberately preserves ProgramData config, logs, backups, PostgreSQL database, role, and all business data, then tells the operator: "Business data and backups were preserved." Database deletion is not offered. Any later destructive retirement must be a separately reviewed DBA procedure with a verified backup.

Failed fresh setup removes only installer-created tasks. It clears temporary credentials and preserves any database resources already created for operator review instead of attempting dangerous generic cleanup. It does not alter PostgreSQL networking, unrelated databases/programs/tasks, firewall rules, or Tailscale.

## Isolated drill

Never drill against the live `HamdFoodsERP`/3100 deployment. The drill build hard-codes and validates these separate resources:

- app: `C:\Program Files\HamdFoodsERP-InstallDrill`
- data: `C:\ProgramData\HamdFoodsERP-InstallDrill`
- tasks: `HamdFoodsERP-InstallDrill` and `HamdFoodsERP-InstallDrill-Backup`
- port: `3200`
- database/role: `hamd_foods_erp_installer_drill` / `hamd_erp_installer_drill`
- shortcuts/group: `Hamd Foods ERP Installer Drill` (never the production shortcut names)

```powershell
$env:HAMDFOODS_RUN_INSTALLER_DRILL = "1"
corepack pnpm installer:drill
Remove-Item Env:HAMDFOODS_RUN_INSTALLER_DRILL
```

The command prepares and verifies the same payload, compiles the isolated Inno variant, and launches it only with that explicit opt-in. It checks recovery, exact-origin login/dashboard/direct-signup rejection, repair, the same authentication checks again, and then runs the isolated uninstaller. Verify elevation, payload, config ACL, migrations discovered at execution time, seed, bootstrap, SYSTEM task, loopback 3200 health/login, backup create/verify, uninstall preservation, and that the live 3100 task/Serve configuration never changed. An absent compiler means the drill is not run and Phase 32 remains partial; do not simulate evidence.

## Software updates (Phase 34)

`Setup-HamdFoodsERP.ps1` additionally registers a trigger-less SYSTEM `HamdFoodsERP-Update` Scheduled Task (and its isolated-drill counterpart), armed on demand from `Administration -> Updates` rather than by any trigger. The installed layout stays exactly as described above until the first update actually runs: an update lazily adopts a versioned `releases\<version>\{app,operations,runtime}` layout plus an atomic `AppRoot\active-release.json` pointer, while `AppRoot\windows` and the original `AppRoot\runtime\node` are never touched by an update. `Remove-HamdFoodsScheduledTasks` (repair/uninstall) also stops and unregisters `HamdFoodsERP-Update`. See `docs/operations/software-updates.md` for the full update model, secure extraction rules, and rollback policy.

## Troubleshooting

- `Installer Compiler: FAIL`: install official Inno Setup 7 machine-wide or per-user, or set `INNO_SETUP_COMPILER` to an absolute standalone `ISCC.exe`. A configured but invalid override fails closed instead of silently selecting another executable.
- `PostgreSQL: MISSING`: install supported PostgreSQL 16 with command-line tools, or prepare a checksum-verified official prerequisite payload.
- `PostgreSQL: MISSING` despite a running PG16 service: confirm the packaged setup includes native Program Files discovery and verify all four tools under the selected `PostgreSQL\16\bin`; do not copy tools into `Program Files (x86)`.
- Post-install failure: inspect the protected `C:\ProgramData\HamdFoodsERP\logs\installer\provisioning.log` (or the corresponding isolated drill root) for the exact sanitized failing stage and exit code before retrying.
- `UNSUPPORTED`: remove the ambiguity with a DBA; setup will not select another major automatically.
- `Port 3100 is occupied`: identify the owning process. Stop only a positively identified prior Hamd Foods ERP task, or use a reviewed future alternate-port package that keeps the URL/config consistent.
- ACL failure: inspect the exact ProgramData tree for malicious/reparse content; do not grant Users, Authenticated Users, or Everyone.
- Health failure: inspect non-secret application/task logs, PostgreSQL service status, and loopback listeners. Never paste the config contents into a ticket.
- Forgotten administrative login: on the factory server, open **Start Menu → Hamd Foods ERP → Account Recovery**, approve UAC, select the active administrative account, then change its login email, password, or both. Do not create a browser reset endpoint or pass a password to the script as an argument.
