# Phase 28 Backup and Recovery Implementation Plan

> **For agentic workers:** Use the host's available task-by-task implementation workflow. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add transaction-consistent PostgreSQL custom backups, checksum manifests, guarded isolated restores, retention, and a database-backed recovery drill.

**Architecture:** `src/server/operations/database-backup.ts` owns all backup artifact, PostgreSQL process, restore safety, retention, and integrity behavior. Thin scripts expose operator commands, while the existing managed test-database lifecycle alone owns the destructive drill against fixed source and restore databases.

**Tech Stack:** TypeScript, Node.js filesystem/crypto/child-process APIs, PostgreSQL `pg_dump`/`pg_restore`/`dropdb`/`createdb`, `pg`, Vitest, Prisma migration metadata, pnpm.

## Global Constraints

- Use PostgreSQL custom-format logical backups; never include `.env` or credentials in artifacts.
- Verify checksum and manifest before any restore mutation; reject development, source, system, ambiguous, or production-looking targets.
- Restore drills use only `factory_erp_test` and `factory_erp_restore_test` on the managed Phase 27 cluster.
- Preserve exact accounting, inventory, valuation, audit, and reversal data without repair writes.
- Retention deletes only validated regular-file pairs directly inside the configured backup directory.
- Do not implement deployment, PWA, Tailscale, cloud storage, automatic scheduling, or production overwrite.
- Perform one implementation pass and one final verification sequence without delegation.

---

### Task 1: Backup artifact and safety core

**Files:**

- Create: `src/server/operations/database-backup.ts`
- Test: `src/server/operations/database-backup.test.ts`
- Modify: `.gitignore`

**Interfaces:**

- Consumes: PostgreSQL URL, optional backup directory/tool paths/retention policy.
- Produces: `createBackup`, `verifyBackupArtifact`, `listBackups`, `applyRetention`, `assertSafeRestoreTarget`, and `restoreBackup`.

- [x] Add tests for traversal, unsafe target names, checksum mismatch, and retention containment.
- [x] Export a PostgreSQL snapshot and use it for both manifest facts and `pg_dump --format=custom`.
- [x] Validate the archive with `pg_restore --list`, stream SHA-256, atomically rename the dump, then publish the manifest.
- [x] Parse manifests fail-closed and keep credentials/connection endpoints out of metadata.
- [x] Apply retention only to validated regular `.dump`/`.manifest.json` pairs inside the configured root.

### Task 2: Guarded restore and integrity proof

**Files:**

- Modify: `src/server/operations/database-backup.ts`
- Create: `scripts/backup-restore-drill.ts`

**Interfaces:**

- Consumes: verified backup identifier, `RESTORE_DATABASE_URL`, source/development protection context.
- Produces: isolated restored database plus exact fact and reconciliation report.

- [x] Reject system, source, development, non-restore/test, and production-looking database names.
- [x] Check manifest, regular-file boundary, byte size, and SHA-256 before `dropdb` or `createdb`.
- [x] Restore with `pg_restore --exit-on-error --single-transaction --no-owner --no-privileges`.
- [x] Verify expected tables, Prisma migration count/latest migration, and exact source/restored counts and totals.
- [x] Verify posted journals, AR, AP, inventory valuation, completed-batch WIP, inventory health, and audit preservation.
- [x] Prove corrupt checksum rejection occurs while the restore target remains absent.

### Task 3: Commands, managed drill, and lint cleanup

**Files:**

- Create: `scripts/database-backup.ts`
- Modify: `scripts/test-database.ts`
- Modify: `src/test/test-environment.ts`
- Modify: `package.json`
- Modify: `src/server/inventory/transactional-inventory-posting.test.ts`

**Interfaces:**

- Consumes: `DATABASE_URL`, `RESTORE_DATABASE_URL`, `BACKUP_DIRECTORY`, `POSTGRES_BIN`, optional explicit dump/restore paths.
- Produces: `backup:create`, `backup:list`, `backup:verify`, `backup:restore`, and `backup:drill` package commands.

- [x] Add one thin CLI with non-secret, actionable exit messages.
- [x] Extend the managed lifecycle with one `backup-drill` action that resets/seeds the source and invokes the fixed restore drill.
- [x] Keep source and restore databases coexisting after successful comparison.
- [x] Replace four unused mock arguments with one typed mock helper without production changes or lint suppression.

### Task 4: Operations documentation and final gate

**Files:**

- Create: `docs/operations/backup-and-recovery.md`
- Modify: `docs/README.md`
- Modify: `docs/engineering/testing.md`
- Modify: `docs/phases/current.md`

**Interfaces:**

- Consumes: implemented commands and observed final command results.
- Produces: operator runbook, provisional RPO/RTO, manual production boundary, and Phase 28 evidence.

- [x] Document format, manifest, commands, retention, isolated recovery, drill, and failure behavior.
- [x] Document daily/manual backup recommendations, monthly restore rehearsal, Task Scheduler guidance, and manual off-site copy requirement without claiming either exists.
- [x] Run once: `corepack pnpm verify` (failed at TypeScript on missing `pg` declarations after earlier stages passed; not rerun).
- [x] Run once: `corepack pnpm test:integration` (passed 2 files and 7 tests).
- [x] Run once: `corepack pnpm backup:drill` (passed all backup, restore, retention, and integrity checks).
- [x] Record the partial result and prepare the required checkpoint commit without repeating verification suites.

## Unresolved externally observable decisions

None. The Phase 28 specification fixes the local artifact format, safe restore naming policy, managed drill endpoints, default retention approach, and manual production/off-site boundaries.
