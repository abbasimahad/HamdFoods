# Production Docker deployment

Phase 30 provides a local, single-host production deployment foundation. It is deliberately **localhost-only**: the ERP is available at `http://127.0.0.1:3000` on the factory PC and is not exposed to the LAN, Internet, Tailscale, a reverse proxy, or public DNS.

The production stack is separate from local development. Never run production commands with `.env`, and never run development commands with `.env.production`.

## Prerequisites

- Docker Desktop or Docker Engine running on the factory PC, with Docker Compose v2;
- Node.js 24, Corepack, and the repository's pinned pnpm for host-side quality checks;
- a checked-out, reviewed Git release/commit;
- an operator-controlled backup directory with sufficient free space.

Docker must be running again after Windows restarts before its `unless-stopped` containers can recover. Phase 30 does not install startup tasks, modify Windows Firewall rules, or configure Docker Desktop startup.

## Production environment

From PowerShell, create the ignored production file and set unique values:

```powershell
Copy-Item .env.production.example .env.production
$secretBytes = New-Object byte[] 48
[System.Security.Cryptography.RandomNumberGenerator]::Fill($secretBytes)
[Convert]::ToBase64String($secretBytes)
```

Put the generated value into `BETTER_AUTH_SECRET`; do not echo the completed file, commit it, reuse a development/E2E secret, or change it during ordinary restarts and upgrades. Changing this secret unexpectedly can invalidate Better Auth sessions and assumptions.

Set a separate strong `POSTGRES_PASSWORD`, a dedicated `POSTGRES_USER`/`POSTGRES_DB`, and a `PRODUCTION_BACKUP_DIRECTORY` such as `./.backups-production`. The Compose file constructs the internal `DATABASE_URL` with the private hostname `database:5432`; do not add a `DATABASE_URL` value pointing to `localhost`.

For the local Phase 30 smoke check, retain:

```text
BETTER_AUTH_URL=http://127.0.0.1:3000
```

Phase 31 may change that value to the authoritative private HTTPS Tailscale origin without an application code rewrite. Do not configure a Tailscale hostname in Phase 30.

Validate configuration before building. It expands values locally, so run it only in a trusted PowerShell session and do not paste its output containing real values into tickets or commits.

```powershell
corepack pnpm production:config
```

## Initial setup and startup

`production:start` starts PostgreSQL, waits for `pg_isready`, runs one `prisma migrate deploy` service, and starts the standalone Next.js container only after migrations succeed. Migration failure leaves the migrator exited and the application stopped; inspect logs and correct the release/configuration rather than resetting the database.

```powershell
corepack pnpm production:build
corepack pnpm production:start
corepack pnpm production:status
```

Migrations are the only automatic database operation. Access/master-data reconciliation and SUPER_ADMIN bootstrap are explicit one-off operations:

```powershell
corepack pnpm production:seed
# Temporarily add BOOTSTRAP_ADMIN_NAME, BOOTSTRAP_ADMIN_EMAIL, and BOOTSTRAP_ADMIN_PASSWORD to .env.production.
corepack pnpm production:bootstrap
```

After confirming the administrator can log in, remove all three `BOOTSTRAP_ADMIN_*` values from `.env.production`. The bootstrap command will not reset an existing SUPER_ADMIN password, and neither it nor broad seeding runs when containers restart.

Use these normal operations commands:

```powershell
corepack pnpm production:status
corepack pnpm production:logs
corepack pnpm production:restart
corepack pnpm production:stop
```

`production:stop` stops containers without deleting the project-namespaced `hamd_factory_postgres_data` volume. Never use `docker compose down --volumes` for the production project unless an explicitly authorized retirement/recovery procedure has already preserved the data.

## Health and local smoke check

The application container health check calls unauthenticated `GET /api/health` internally. It returns only `{"status":"ok"}` with HTTP 200 when the app and database probe are ready; it returns `{"status":"unavailable"}` with HTTP 503 otherwise. It never returns credentials, connection strings, records, or stack traces.

From the factory PC, verify:

```powershell
Invoke-WebRequest http://127.0.0.1:3000/api/health | Select-Object StatusCode, Content
Invoke-WebRequest http://127.0.0.1:3000/manifest.webmanifest | Select-Object StatusCode
Invoke-WebRequest http://127.0.0.1:3000/sw.js | Select-Object StatusCode
Invoke-WebRequest http://127.0.0.1:3000/offline.html | Select-Object StatusCode
```

Then use a private browser session to confirm: unauthenticated `/dashboard` redirects to `/login`; the temporary administrator can sign in; a representative protected ERP page renders; and logout removes protected access. Localhost qualifies as a secure service-worker context, but Phase 29's conservative online-only cache and mutation policy remains unchanged.

`docker compose ... ps` must show no database host port and an app binding of `127.0.0.1:3000->3000/tcp`. Do not open Windows Firewall ports, bind `0.0.0.0`, add a LAN mapping, install Tailscale, or configure a proxy/tunnel in this phase.

## Backups and recovery boundary

The explicit `operations` Compose profile runs the existing Phase 28 `scripts/database-backup.ts` implementation with PostgreSQL 18 client tools on the private Compose network. It retains the existing custom dump, manifest, SHA-256 verification, retention, and safety rules; it is not a separate backup implementation.

With the stack running:

```powershell
corepack pnpm production:backup -- create
corepack pnpm production:backup -- list
corepack pnpm production:backup:verify -- <backup-id>
```

Before every production application/schema upgrade, create and verify a backup first. Keep completed `.dump` and `.manifest.json` pairs in the selected backup directory and copy them to separately controlled storage according to the Phase 28 recovery policy.

The automated restore command intentionally rejects production-named targets. For a real production recovery, follow [backup and recovery](backup-and-recovery.md): restore and verify an isolated database first, obtain operational approval, stop writes, then use DBA-controlled promotion/copy procedures. Do not invent automatic down migrations or restore over the live production volume.

## Update and rollback

For a reviewed new release:

1. Confirm the desired clean Git commit.
2. Create and verify a production backup.
3. Update the working tree to the approved release.
4. Run `corepack pnpm production:build`.
5. Run `corepack pnpm production:start`; migrations deploy before the app can become healthy.
6. Check `production:status`, `/api/health`, and the authenticated local smoke check.

An application rollback may be possible by rebuilding/redeploying an older approved image only when its schema is compatible with the already-deployed database. Database rollback is never automatic; use the verified Phase 28 recovery workflow only when explicitly required.

## Isolated production drill

When Docker is available, use a separate project name and `.env.production.drill` copied from the example with distinct credentials/database/backup directory:

```powershell
docker compose --project-name hamd-foods-erp-prod-drill --env-file .env.production.drill -f compose.production.yaml build
docker compose --project-name hamd-foods-erp-prod-drill --env-file .env.production.drill -f compose.production.yaml up -d
docker compose --project-name hamd-foods-erp-prod-drill --env-file .env.production.drill -f compose.production.yaml ps
```

Run the explicit seed/bootstrap steps against that drill project, verify health/login/protected route/logout and manifest/service-worker/offline files, then recreate the app and database containers **without** `--volumes` and verify the seeded/admin state persists. Finally run `operations create` and `operations verify` against the drill backup directory. Do not reset, migrate, restore, or overwrite the development database or any real production volume while proving the drill.

Phase 31 is the boundary for Tailscale installation, private remote HTTPS access, phone access over the tailnet, and Better Auth origin transition. Phase 30 provides none of those capabilities.
