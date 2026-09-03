# Native Windows installer

Phase 32 packages Hamd Foods ERP as an elevated Inno Setup installation. A factory PC runs the installed product from `C:\Program Files\HamdFoodsERP`; it does not need Git, source code, Node, Corepack, pnpm, npm, Docker, Developer Mode, or VS Code. Mutable state and secrets live under `C:\ProgramData\HamdFoodsERP`.

## Release-engineering prerequisites

Use 64-bit Windows, an elevated shell, the repository-pinned pnpm, Node 24.11.1, a proven `production:build`, and current Inno Setup from the [official download](https://jrsoftware.org/isdl.php). Inno Setup is not downloaded automatically. If `ISCC.exe` is outside its normal Program Files location, set `INNO_SETUP_COMPILER` to its absolute path.

The build downloads `node-v24.11.1-win-x64.zip` only from the official Node distribution and verifies the pinned SHA-256 before copying `node.exe` into the payload. The archive remains in ignored `.installer-cache`; install time is offline for Node. `installer:prepare` stages the minimized Next standalone output, generated static/public assets, migration history, targeted Prisma CLI dependency closure, and bundled seed/bootstrap/backup programs. It rejects `.env` files, repository source, tests, backups, logs, certificates, archives, and generated installer inputs.

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

Run the installer from a local drive. It requires Administrator elevation, supports x64 Windows, offers a desktop shortcut and a daily 02:00 backup task, and always creates a Start Menu link to `http://127.0.0.1:3100`. The setup detects a running PostgreSQL 16 service and its native tools. Missing PostgreSQL causes the bundled official prerequisite to open when one was deliberately supplied; otherwise setup stops with the exact prerequisite. Another detected PostgreSQL major, missing tools, a non-loopback 5432 listener, or an unrelated port-3100 listener fails closed. Setup never kills an unrelated process or adds inbound firewall rules.

Fresh setup creates only the non-superuser `hamd_erp` role and its `hamd_foods_erp` database. It refuses to claim either name if it already exists without managed configuration. A cryptographic RNG generates a 32-byte hex database password and 48-byte hex Better Auth secret. They are never printed or placed on a process command line. PostgreSQL administrator credentials are held only in process memory/`PGPASSWORD` for the command and then cleared; the ACL-protected SQL file is deleted in `finally`.

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
  state\
```

The data tree and config have inheritance removed and allow only `SYSTEM` and built-in Administrators. Setup fails if it cannot apply and verify that ACL. Config contains loopback host/URLs, the generated secrets, native PostgreSQL tools, and backup retention (`14` newest and `30` days). No bootstrap password is written to it.

Setup applies the committed history with `prisma migrate deploy`, runs the idempotent production seed, and securely prompts for the initial SUPER_ADMIN name, email, password, and confirmation. Bootstrap values exist only as child-process environment values and are removed immediately. It registers one `HamdFoodsERP` boot task as `SYSTEM`, with an absolute PowerShell executable, installed runner, installed bundled Node, ProgramData config, ProgramData logs, and restart-on-failure settings. The optional `HamdFoodsERP-Backup` task also runs as `SYSTEM`, ignores overlapping starts, and uses native `pg_dump`. Setup starts the ERP, checks health, creates one backup, and verifies its manifest/checksum before succeeding.

Tailscale is optional. Setup neither installs it nor changes Serve, Funnel, device, route, DNS, or unattended settings. Use the separate [private-access runbook](tailscale-private-access.md) after local installation if remote HTTPS is wanted. PostgreSQL and the ERP ports receive no Windows Firewall inbound rules.

## Repair and same-version reinstall

The stable Inno AppId detects the existing product. When protected ProgramData config exists, setup enters repair: it preserves database and Better Auth secrets, reapplies the strict ACL, creates and verifies a backup before migrations, deploys only pending migrations, reruns the idempotent seed, and reconciles the canonical task. It does not rotate credentials, drop data, reset Prisma, or overwrite the existing role/database. Port conflicts still fail closed.

Application logs are under `ProgramData\HamdFoodsERP\logs`; Inno's setup log is shown by the installer and operational setup logs belong under `logs\installer`. Logs may contain status and paths but must never contain database URLs, database passwords, Better Auth secrets, PostgreSQL administrator credentials, or admin passwords.

## Uninstall and failure safety

Normal uninstall removes installer-owned Program Files content and shortcuts and first unregisters only `HamdFoodsERP` and `HamdFoodsERP-Backup`. It deliberately preserves ProgramData config, logs, backups, PostgreSQL database, role, and all business data, then tells the operator: "Business data and backups were preserved." Database deletion is not offered. Any later destructive retirement must be a separately reviewed DBA procedure with a verified backup.

Failed fresh setup removes only installer-created tasks. It clears temporary credentials and preserves any database resources already created for operator review instead of attempting dangerous generic cleanup. It does not alter PostgreSQL networking, unrelated databases/programs/tasks, firewall rules, or Tailscale.

## Isolated drill

Never drill against the live `HamdFoodsERP`/3100 deployment. The drill build hard-codes and validates these separate resources:

- app: `C:\Program Files\HamdFoodsERP-InstallDrill`
- data: `C:\ProgramData\HamdFoodsERP-InstallDrill`
- tasks: `HamdFoodsERP-InstallDrill` and `HamdFoodsERP-InstallDrill-Backup`
- port: `3200`
- database/role: `hamd_foods_erp_installer_drill` / `hamd_erp_installer_drill`

```powershell
$env:HAMDFOODS_RUN_INSTALLER_DRILL = "1"
corepack pnpm installer:drill
Remove-Item Env:HAMDFOODS_RUN_INSTALLER_DRILL
```

The command prepares and verifies the same payload, compiles the isolated Inno variant, and launches it only with that explicit opt-in. Verify elevation, payload, config ACL, migrations discovered at execution time, seed, bootstrap, SYSTEM task, loopback 3200 health/login, backup create/verify, uninstall preservation, and that the live 3100 task/Serve configuration never changed. An absent compiler means the drill is not run and Phase 32 remains partial; do not simulate evidence.

## Troubleshooting

- `Installer Compiler: FAIL`: install current official Inno Setup or set the absolute compiler path.
- `PostgreSQL: MISSING`: install supported PostgreSQL 16 with command-line tools, or prepare a checksum-verified official prerequisite payload.
- `UNSUPPORTED`: remove the ambiguity with a DBA; setup will not select another major automatically.
- `Port 3100 is occupied`: identify the owning process. Stop only a positively identified prior Hamd Foods ERP task, or use a reviewed future alternate-port package that keeps the URL/config consistent.
- ACL failure: inspect the exact ProgramData tree for malicious/reparse content; do not grant Users, Authenticated Users, or Everyone.
- Health failure: inspect non-secret application/task logs, PostgreSQL service status, and loopback listeners. Never paste the config contents into a ticket.
