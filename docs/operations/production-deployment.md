# Native Windows production deployment

Phase 30 hosts Hamd Foods ERP directly on the Windows factory server. Docker is not required and is not a fallback production architecture. The server runs native PostgreSQL, the Next.js standalone runtime, and one Windows Scheduled Task named `HamdFoodsERP`.

Phase 31 optionally adds Tailscale Serve as a separate private HTTPS ingress without changing this local runtime. See [Tailscale private remote access](tailscale-private-access.md). Local startup, health, PostgreSQL, and backup/recovery remain independent of Tailscale.

The ERP and PostgreSQL are deliberately local-only in this phase. Bind the ERP to `127.0.0.1:3100`; bind PostgreSQL with `listen_addresses = 'localhost'` (or loopback-only equivalent). Configure `pg_hba.conf` for the dedicated local application role and do not open Windows Firewall port 5432. Phones and client PCs never connect to PostgreSQL.

## Prerequisites

- Windows 10/11 or an appropriate Windows Server factory host;
- Node.js 24, Corepack, and the pinned pnpm version;
- native PostgreSQL with `pg_isready`, `psql`, `pg_dump`, `pg_restore`, `createdb`, and `dropdb` available either on `PATH` or through `POSTGRES_BIN`;
- a dedicated non-superuser application role such as `hamd_erp`, its `hamd_foods_erp` database, and a reviewed repository release.

The application role needs only its database/schema and migration permissions. PostgreSQL provisioning is an operator/DBA task in Phase 30; Phase 32 may automate first installation.

## Environment and preflight

Copy the placeholder-only template, then restrict the real file so only Administrators and `SYSTEM` can read it:

```powershell
Copy-Item .env.production.example .env.production
icacls .env.production /inheritance:r /grant:r "Administrators:F" "SYSTEM:F"
```

Set `APP_ENV=production`, loopback `HOSTNAME` and `PORT`, a loopback `DATABASE_URL`, and a unique Better Auth secret. Store backups outside the checkout, for example `C:\ProgramData\HamdFoodsERP\backups`. Do not print or commit the completed file. Phase 30 uses `http://127.0.0.1:3100`; for loopback HTTP, `BETTER_AUTH_URL` must exactly match `HOSTNAME` and `PORT`, preventing the origin mismatch that previously reset the sign-in request. A future private origin must use HTTPS. Do not configure Tailscale yet.

Run the non-secret preflight before deployment:

```powershell
corepack pnpm production:preflight
```

It checks Windows, Node 24, the protected environment file, loopback-only host settings, Better Auth validation, native PostgreSQL tool discovery, database connectivity, and reports only the PostgreSQL version. The actual startup path independently runs the same configuration validation before binding the server; malformed values or a non-loopback `HOSTNAME` such as `0.0.0.0` fail closed without requiring database tools or connectivity.

## Initial deployment

The repository uses pnpm's hoisted linker so Windows builds materialize a flat `node_modules` without dependency symlinks. This keeps the minimized Next standalone runtime portable on an ordinary Windows server without Developer Mode or administrator-only symlink privileges. After first receiving this setting, cleanly rematerialize only the repository dependency directory before rebuilding:

```powershell
$repositoryRoot = (Resolve-Path .).Path
$dependencyRoot = (Resolve-Path .\node_modules -ErrorAction Stop).Path
if ([System.IO.Path]::GetDirectoryName($dependencyRoot) -ne $repositoryRoot) {
  throw "Refusing to remove node_modules outside the repository root."
}
Remove-Item -LiteralPath $dependencyRoot -Recurse -Force
corepack pnpm install --frozen-lockfile
corepack pnpm production:build
```

This removes only installed dependency materialization. It does not remove PostgreSQL data, `.env.production`, backups, application source, or other host data. The build runs Prisma generation, `next build`, copies `public` plus `.next/static` into `.next/standalone`, then requires `next`, `react`, and `react-dom` to resolve physically inside that runtime before declaring it prepared. It never copies the complete development `node_modules` tree. Migrations remain explicit and always use `prisma migrate deploy`.

```powershell
corepack pnpm production:build
corepack pnpm production:migrate
corepack pnpm production:seed
```

To create the first SUPER_ADMIN, temporarily add all three `BOOTSTRAP_ADMIN_NAME`, `BOOTSTRAP_ADMIN_EMAIL`, and `BOOTSTRAP_ADMIN_PASSWORD` values to `.env.production`, then run:

```powershell
corepack pnpm production:bootstrap
```

The bootstrap action does not overwrite an existing password. Remove all temporary bootstrap values immediately after confirming the administrator can sign in.

## Background hosting, logs, and health

Install Node 24 machine-wide so `SYSTEM` can use it. Runtime discovery checks only an absolute machine-level `NODE_EXE`, absolute entries from the machine `PATH`, and the standard Program Files Node installation; every candidate must report Node major 24. If Node is installed in another machine-accessible location, set the machine environment variable from an elevated shell:

```powershell
[Environment]::SetEnvironmentVariable("NODE_EXE", "C:\Program Files\nodejs\node.exe", "Machine")
```

Install the built-in Windows Task Scheduler task from an elevated PowerShell session, then start it. Installation first requires `.env.production`, the standalone server, the production runner/validator, and a resolvable Node 24 executable. It creates only `C:\ProgramData\HamdFoodsERP`, its `logs` and `backups` children, and protects that application-owned tree plus `.env.production` for Administrators and `SYSTEM`; it does not alter broad `C:\ProgramData` permissions. The task runs non-interactively as `SYSTEM`, starts at boot, continues across AC/battery transitions, uses the explicit repository working directory and `.env.production`, and asks Windows to restart a failed task. It never puts database or Better Auth secrets in the scheduled command.

```powershell
corepack pnpm production:install-task
corepack pnpm production:task:start
corepack pnpm production:status
corepack pnpm production:health
```

For a supervised foreground diagnostic start, use `corepack pnpm production:start`; it writes stdout/stderr to `C:\ProgramData\HamdFoodsERP\logs\application.log`. View the latest lines without exposing environment values:

```powershell
Get-Content C:\ProgramData\HamdFoodsERP\logs\application.log -Tail 100
```

Stop or remove the task only for maintenance:

```powershell
corepack pnpm production:task:stop
corepack pnpm production:uninstall-task
```

`production:task:start` is idempotent while the task is running and starts it normally after `production:task:stop`, providing the supported restart sequence without an interactive PowerShell window.

The health endpoint returns only `200 {"status":"ok"}` or `503 {"status":"unavailable"}`. After it succeeds, confirm the login, one protected ERP page, logout, `/manifest.webmanifest`, `/sw.js`, and `/offline.html` from the factory server browser.

## Backups and updates

Phase 28's native backup implementation remains authoritative; it preserves its custom dump, manifest, checksum, retention, and restore protections.

```powershell
corepack pnpm production:backup
corepack pnpm production:backup:list
corepack pnpm production:backup:verify -- <backup-id>
```

For each reviewed update: confirm the desired commit, create and verify a backup, stop the background task, install locked dependencies for the checkout, run preflight, build, migrate, intentionally seed only when needed, start the task, check health, and perform the authenticated smoke test. Never use `migrate dev`, `db push`, a reset, or an automated restore over production. Application rollback is allowed only when schema-compatible; database recovery follows the separate verified Phase 28 process.

## Safe native production drill

Use a separate native local database named `hamd_foods_erp_prod_drill`, separate role/credentials, separate `BACKUP_DIRECTORY`, and a copy of `.env.production` that is never pointed at development, Phase 27's test database, or real production. The drill proves direct connectivity, migration deploy, idempotent seed, temporary bootstrap, standalone build, loopback start, health, login/protected route/logout, PWA assets, restart persistence, a safely coordinated PostgreSQL restart/reconnect, and native backup creation/verification. Do not reset or overwrite development, test, or production databases. Phase 31 remains the boundary for private remote HTTPS and phone access.
