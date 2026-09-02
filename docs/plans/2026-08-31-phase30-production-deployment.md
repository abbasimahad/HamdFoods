# Phase 30 Native Windows Production Hosting Plan

> **Status:** replaces and supersedes the Docker/Compose Phase 30 plan at checkpoint `259f2b5`.

**Goal:** Run the localhost-only Hamd Foods ERP on a Windows factory server without Docker.

**Architecture:** Native PostgreSQL remains the authoritative loopback-only database. Native Node 24 runs the Next.js standalone output. A Windows Scheduled Task named `HamdFoodsERP` provides boot-time background hosting, and the established Phase 28 scripts use native PostgreSQL client tools for backups.

## Boundaries

- No Docker files, Compose files, containers, volumes, or Docker commands remain in the product path.
- Production `DATABASE_URL` must use `127.0.0.1`, `localhost`, or `::1`; arbitrary LAN/public and historical `database` hosts are rejected.
- The app binds to `127.0.0.1:3000`; PostgreSQL stays loopback-only. Phase 31, not Phase 30, may add a private HTTPS application origin.
- `.env.production` is ignored and ACL-protected. Bootstrap secrets are one-time operator inputs and are removed after use.
- Production migration is `prisma migrate deploy`; backups/recovery retain the Phase 28 manifest, checksum, retention, and restore protections.

## Delivery and drill

1. Validate native production environment and tool discovery.
2. Generate Prisma, build standalone output, and prepare its static/public assets.
3. Deploy migrations, intentional idempotent seed, and optional one-time SUPER_ADMIN bootstrap.
4. Install and operate the Windows startup task; check logs and `/api/health`.
5. Prove an isolated native production drill against a separately named local database and backup root. Do not advance to Phase 31 until it succeeds.
