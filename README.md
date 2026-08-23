# Factory ERP

A production-oriented modular-monolith foundation for a food manufacturing ERP. The completed Phase 8 foundation includes RBAC-protected master data, an immutable inventory ledger, suppliers, purchase orders, goods receiving, purchase QC, and supplier-lot traceability.

## Current status

Phase 8 is complete: approved POs support partial GRNs into QUALITY_HOLD, exact QC acceptance into AVAILABLE, rejection into QUARANTINE, and derived PO fulfilment without accounting effects. See [`docs/phases/current.md`](docs/phases/current.md) for exact evidence.

## Prerequisites

- Node.js 24 LTS
- Corepack and pnpm 11.22.0
- Docker Engine or Docker Desktop with Docker Compose v2

Enable the repository's pinned package manager if needed:

```powershell
corepack enable
pnpm --version
```

## Local setup

1. Create a local environment file. It is ignored by Git:

   ```powershell
   Copy-Item .env.example .env
   ```

2. Replace the example password in `.env`. Keep `POSTGRES_PASSWORD` and the password embedded in `DATABASE_URL` identical.
3. Install exact locked dependencies:

   ```powershell
   pnpm install --frozen-lockfile
   ```

4. Start PostgreSQL and inspect its health:

   ```powershell
   pnpm db:start
   pnpm db:status
   ```

5. Apply the migration, seed access policy, bootstrap the first SUPER_ADMIN, and prove connectivity:

   ```powershell
   pnpm db:validate
   pnpm db:generate
   pnpm db:migrate
   pnpm db:seed
   pnpm auth:bootstrap
   pnpm db:check
   ```

6. Start the application and open `http://localhost:3000`:

   ```powershell
   pnpm dev
   ```

The database port is published only on the local loopback interface. The browser never receives `DATABASE_URL` or PostgreSQL credentials.

## Database commands

| Command                 | Purpose                                                                                                  |
| ----------------------- | -------------------------------------------------------------------------------------------------------- |
| `pnpm db:start`         | Start the local PostgreSQL container.                                                                    |
| `pnpm db:stop`          | Stop it without deleting the named volume.                                                               |
| `pnpm db:status`        | Show container and health status.                                                                        |
| `pnpm db:logs`          | Follow PostgreSQL logs.                                                                                  |
| `pnpm db:validate`      | Validate Prisma configuration and schema.                                                                |
| `pnpm db:generate`      | Generate the ignored Prisma client under `src/generated/`.                                               |
| `pnpm db:migrate`       | Create/apply a development migration after an intentional schema change.                                 |
| `pnpm db:check`         | Execute a real `SELECT 1` through the application's Prisma boundary.                                     |
| `pnpm db:reset`         | **Destructive:** prompts before resetting the development database and losing its data.                  |
| `pnpm auth:seed`        | Idempotently reconcile the permission registry and seven default role mappings.                          |
| `pnpm auth:bootstrap`   | Create/reactivate the environment-configured first SUPER_ADMIN without overwriting an existing password. |
| `pnpm master-data:seed` | Idempotently reconcile standard units and starter item categories.                                       |
| `pnpm db:seed`          | Reconcile both access-control and master-data seeds.                                                     |

Bootstrap credentials are server-only and are loaded only by the explicit bootstrap command. Public signup is disabled.

## Quality commands

```powershell
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm verify
```

`pnpm verify` runs all important non-destructive static, test, Prisma, and production-build checks. It requires a valid `.env`, but it does not require a running database. Run `pnpm db:check` separately for live connectivity.

## Pinned foundation versions

| Technology       | Version             |
| ---------------- | ------------------- |
| Node.js          | 24 LTS (`>=24 <25`) |
| pnpm             | 11.22.0             |
| Next.js          | 16.3.2              |
| React            | 19.2.8              |
| PostgreSQL image | 18.6 Alpine 3.24    |
| Prisma ORM       | 7.9.1               |
| Better Auth      | 1.7.1               |
| decimal.js       | 10.6.0              |
| Tailwind CSS     | 4.3.3               |
| Zod              | 4.4.3               |
| Vitest           | 4.1.11              |
| TypeScript       | 6.0.3               |
| ESLint           | 9.39.5              |

TypeScript 6 and ESLint 9 are the newest stable lines compatible with the current Next.js lint dependency graph; the newer stable majors produced peer conflicts and were not retained.

## Repository documentation

Start with [`docs/README.md`](docs/README.md). It maps the architecture, domain vocabulary, engineering conventions, security rules, decisions, and current phase gate.
