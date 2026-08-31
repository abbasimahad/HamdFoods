# Phase 30 Production Docker Deployment Implementation Plan

> **For agentic workers:** Use the host's available task-by-task implementation workflow. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Provide a localhost-only, production Docker Compose foundation for Hamd Foods ERP with deterministic migrations, health checks, durable PostgreSQL data, and Phase 28-compatible backups.

**Architecture:** Keep `compose.yaml` as the local-development database stack and add a fully separate `compose.production.yaml` project. A multi-stage Node 24 Dockerfile builds Next standalone output; a one-off migration service gates the non-root application container on successful `prisma migrate deploy`; an operations-only service reuses the existing backup implementation and PostgreSQL 18 client utilities over the internal Compose network.

**Tech Stack:** Docker Compose v2, Docker multi-stage Node 24 Alpine build, Next.js 16 standalone output, Prisma 7, PostgreSQL 18.6 Alpine, TypeScript, Vitest, Playwright, PowerShell.

## Global Constraints

- Do not modify the development `compose.yaml` contract or require production Docker configuration for `pnpm dev`, tests, or development database commands.
- The production database has no `ports` entry. The application maps only `127.0.0.1:${APP_PORT}:3000`; no LAN, Internet, Tailscale, reverse proxy, firewall, CI/CD, or Phase 31 work is introduced.
- Production credentials remain only in ignored `.env.production`; committed configuration uses placeholders and never logs secret values.
- Production migration uses one non-restarting `prisma migrate deploy` service. It never runs `migrate dev`, `db push`, reset, bootstrap, or broad seed work automatically.
- App and database use `unless-stopped`; a failed migration prevents app startup and surfaces as an exited migration service rather than a hidden restart loop.
- Business data persists only in a project-namespaced named PostgreSQL volume. The application filesystem is immutable and the app runs as the built-in non-root Node user.
- Health output is minimal and unauthenticated: `200 {"status":"ok"}` only when the server and database are ready, otherwise `503 {"status":"unavailable"}`. It exposes no secret, URL, stack trace, or user data.
- Backup creation/list/verification continues to use `scripts/database-backup.ts` and its manifest, checksum, retention, PostgreSQL-version, and restore guards. Restore to production remains a manual DBA-controlled recovery boundary.
- Docker is unavailable on this host. Static configuration and all existing quality gates can be verified, but Docker config validation and the isolated production drill must be documented as blocked and Phase 30 cannot be marked complete.

---

### Task 1: Production runtime and Compose boundary

**Files:**

- Create: `Dockerfile`
- Create: `compose.production.yaml`
- Create: `.dockerignore`
- Create: `.env.production.example`
- Modify: `.gitignore`
- Modify: `next.config.ts`
- Modify: `package.json`

**Interfaces:**

- Consumes: locked `package.json`/`pnpm-lock.yaml`, `prisma/schema.prisma`, `prisma/migrations`, Next standalone output, production environment variables.
- Produces: `app`, `database`, `migrator`, and profile-gated `operations` Compose services under `hamd-foods-erp-prod`, plus PowerShell-friendly `pnpm production:*` commands.

- [ ] **Step 1: Add the focused failing test**

Add production environment cases that require non-empty PostgreSQL variables and a `database` service hostname when `APP_ENV=production`; retain valid development and test environment behavior.

- [ ] **Step 2: Verify the relevant failure**

Run: `corepack pnpm test -- src/server/env.test.ts`

Expected: current production-shaped input is accepted without the Compose-only PostgreSQL boundary checks, proving the deployment validation is absent.

- [ ] **Step 3: Implement the minimum behavior**

Enable `output: "standalone"`. Build dependencies with Corepack and `pnpm install --frozen-lockfile`; run Prisma generation before the Next build; copy only standalone output, static assets, and public assets to a non-root Node 24 runtime. Keep a separate source-plus-Prisma `migrator` target and a profile-gated operations target carrying PostgreSQL 18 client tools and the existing backup script.

Compose must interpolate its database URL with `database:5432`, expose no database port, wait for `pg_isready`, run migrations once with `restart: "no"`, bind the app only to `127.0.0.1`, and health-check `/api/health` internally. The committed environment template contains placeholders only; `.env.production` and production backup artifacts are ignored. Package scripts must always pass both `--env-file .env.production` and `-f compose.production.yaml`.

- [ ] **Step 4: Verify the focused pass**

Run: `corepack pnpm test -- src/server/env.test.ts`

Expected: production input missing PostgreSQL variables or using a non-Compose database host is rejected without printing secret values; valid production input remains accepted.

- [ ] **Step 5: Run the affected integration check**

Run: `corepack pnpm verify`

Expected: formatting, lint, tests, Prisma generation, TypeScript, and standalone production build pass.

- [ ] **Step 6: Commit the passing deliverable**

```bash
git add Dockerfile compose.production.yaml .dockerignore .env.production.example .gitignore next.config.ts package.json src/server/env.ts src/server/env.test.ts
git commit -m "feat: add production Compose foundation"
```

### Task 2: Minimal readiness endpoint

**Files:**

- Create: `src/app/api/health/route.ts`
- Create: `src/app/api/health/route.test.ts`
- Modify: `src/modules/system/application/get-system-health.ts` only if a pure status-to-response boundary is necessary for testability.

**Interfaces:**

- Consumes: `getSystemHealth(probeDatabase)` and the existing Prisma `SELECT 1` probe.
- Produces: `GET /api/health` returning `200 { status: "ok" }` for a connected database and `503 { status: "unavailable" }` for a failed probe.

- [ ] **Step 1: Add the focused failing test**

Mock only `probeDatabase` at the server infrastructure boundary. Assert the route returns the exact minimal successful body/status when the probe resolves and the exact minimal unavailable body/status when it rejects.

- [ ] **Step 2: Verify the relevant failure**

Run: `corepack pnpm test -- src/app/api/health/route.test.ts`

Expected: the route module is absent, proving no production-safe health contract exists.

- [ ] **Step 3: Implement the minimum behavior**

Add a dynamic GET route that delegates to the existing system health application function and maps its database state to the two documented responses. Do not reuse the human-facing `/system-health` page, add authentication, cache a stale healthy result, or leak exception detail.

- [ ] **Step 4: Verify the focused pass**

Run: `corepack pnpm test -- src/app/api/health/route.test.ts`

Expected: both success and failure response assertions pass.

- [ ] **Step 5: Run the affected integration check**

Run: `corepack pnpm verify`

Expected: the production build registers `/api/health` and all existing checks remain green.

- [ ] **Step 6: Commit the passing deliverable**

```bash
git add src/app/api/health/route.ts src/app/api/health/route.test.ts src/modules/system/application/get-system-health.ts
git commit -m "feat: add production readiness endpoint"
```

### Task 3: Windows production operations and evidence documentation

**Files:**

- Create: `docs/operations/production-deployment.md`
- Modify: `docs/README.md`
- Modify: `README.md`
- Modify: `docs/phases/current.md`

**Interfaces:**

- Consumes: `pnpm production:*` scripts, production Compose services, the explicit bootstrap/seed scripts, Phase 28 backup commands, Phase 29 PWA paths, and Docker Desktop on Windows.
- Produces: executable PowerShell guidance for setup, config validation, initial migration/seed/bootstrap, start/stop/status/logs, backup/create/verify, updates, rollback boundaries, reboot behavior, and an honest Phase 30 evidence record.

- [ ] **Step 1: Add the focused failing test**

No code-level test applies. Treat the missing operator procedure as the observable documentation gap: every required operation has no production-specific command path before this task.

- [ ] **Step 2: Verify the relevant failure**

Run: `rg -n "production:|compose.production|\.env.production" README.md docs/operations docs/README.md`

Expected: no complete production-only runbook is present.

- [ ] **Step 3: Implement the minimum behavior**

Document explicit `--env-file .env.production` commands, secret generation through PowerShell/.NET without printing secrets, temporary one-off bootstrap removal, pre-upgrade create+verify backup, automatic migration gating, manual seed/reconciliation, health/auth/PWA smoke checks, named-volume persistence checks, safe app rollback versus explicit backup-based database recovery, Docker-after-reboot expectation, localhost-only/firewall exposure, and Phase 31 exclusions. State that the operational tools service mounts an operator-selected host backup directory but does not expose PostgreSQL.

- [ ] **Step 4: Verify the focused pass**

Run: `rg -n "production:config|production:backup|127\.0\.0\.1|Phase 31|migrate deploy|bootstrap" docs/operations/production-deployment.md`

Expected: all required operator boundaries and commands are present.

- [ ] **Step 5: Run the affected integration check**

Run: `corepack pnpm format:check`

Expected: committed configuration and documentation meet repository formatting rules.

- [ ] **Step 6: Commit the passing deliverable**

```bash
git add docs/operations/production-deployment.md docs/README.md README.md docs/phases/current.md
git commit -m "docs: add phase 30 production operations"
```

## Final verification

Run exactly once after the cohesive implementation pass:

```powershell
corepack pnpm verify
corepack pnpm test:integration
corepack pnpm test:e2e
docker compose --env-file .env.production.example -f compose.production.yaml config
git diff --check
```

If Docker is available, run the documented isolated `hamd-foods-erp-prod-drill` sequence: build, start database, apply all migrations, explicitly seed/bootstrap a temporary admin, start app, check health/auth/protected route/logout/PWA files, recreate app and database containers without the volume, and create/verify a Phase 28-compatible backup. Do not run a restore against a production-named database. If Docker is unavailable, record the Compose validation and full drill as blocked and mark Phase 30 PARTIAL.
