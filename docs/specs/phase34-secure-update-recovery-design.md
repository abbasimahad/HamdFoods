# Phase 34 — Secure Offline Software Update & Failed-Update Recovery Design

Status: **DESIGN FROZEN (D1-D10 APPROVED WITH AMENDMENTS) — NOT IMPLEMENTED**. Target: safely updating an already-installed, already-licensed Hamd Foods ERP customer installation to a new application version, entirely offline, with no destructive failure mode.

## 1. Current infrastructure (grounding)

- **Installer payload model** (`scripts/installer.ts`, `installer/HamdFoodsERP.iss`): a release is assembled into `payload/{app, operations, windows, runtime/node, prerequisites}`. `app/` is the Next standalone build; `operations/` is a set of esbuild-bundled, dependency-free `.mjs` CLI entry points (`seed-all.mjs`, `bootstrap-super-admin.mjs`, `database-backup.mjs`, `account-recovery.mjs`) plus a bundled Prisma client and the full `prisma/migrations/` directory; `windows/` is every `installer/scripts/*.ps1` file (copied wholesale — this is how Phase 33's `Dpapi-HamdFoodsERP.ps1`/`Fingerprint-HamdFoodsERP.ps1` scripts already ship); `runtime/node/` is one pinned, SHA-256-checked Node binary. Nothing under `AppRoot` requires Git, pnpm, tsx, or a repository checkout at runtime.
- **Staged, resumable provisioning** (`Setup-HamdFoodsERP.ps1`): install/repair is a named-stage state machine (`ConfigurationWrite → MigrationDeployment → SeedExecution → AdministratorBootstrap → TaskRegistration → RuntimeStartup`) persisted to `provisioning-state.json`, so a crash resumes from the last completed stage. Repair already takes a verified pre-migration backup before `prisma migrate deploy`.
- **Runtime control**: `Stop-HamdFoodsManagedRuntime` identifies the exact listener on the configured port, verifies it is the exact installed `node.exe` by path, and terminates only that process tree. `Register-ApplicationTask` creates `HamdFoodsERP` as an `AtStartup`, `RunLevel Highest`, `SYSTEM`-identity Scheduled Task. `Wait-Healthy` polls `/api/health` for up to 60 seconds after every start.
- **Migrations**: every migration in this project's history (44 so far) is additive-only; production always uses `prisma migrate deploy` (tracked, idempotent, append-only against `_prisma_migrations`); `migrate dev`/`migrate reset` are never invoked by any production or installed script.
- **Backup/restore**: `pg_dump --format=custom`, SHA-256-verified manifest, `pg_restore --list` validation before a manifest is published. Restore is a separate, explicitly-targeted, guarded, never-automatic command.
- **Licensing** (Phase 33): license files live under `DataRoot\config`, DPAPI/HMAC-protected, bound to machine fingerprint and validity window, never to application version. `administration/license` actions are exempt from license-restricted mode by design — the direct precedent for D10 below.
- **ProgramData layout**: `DataRoot\{config, logs, backups, state}`, ACL'd to `SYSTEM + Administrators` with container inheritance; anything created inside inherits that ACL.
- **Crypto note**: Windows PowerShell 5.1 (Desktop CLR) has no native Ed25519 support. Phase 33 resolved the equivalent problem (DPAPI) by keeping PowerShell responsible for OS mechanics only and delegating all cryptography to the bundled Node runtime. Phase 34 keeps that division of labor.

**Conclusion, amended:** Phase 34 reuses Phase 33's proven patterns (DPAPI-protected state, staged resumability, bundled-Node cryptography, SYSTEM Scheduled Tasks) but does **not** reuse the installed-directory shape as-is. D6 below replaces the flat `AppRoot\{app,operations,windows,runtime}` layout with versioned releases plus a stable, never-replaced bootstrap component, specifically so the update mechanism can never lock, corrupt, or depend on the exact files it is in the middle of replacing.

## 2. Update package (D1 — approved)

**Format:** unchanged — a single ordinary ZIP file, `HamdFoodsERP-Update-<toVersion>.hfupdate`, extractable with PowerShell 5.1's built-in `System.IO.Compression` (no third-party tool). Contents: `manifest.json` (canonical, unsigned), `manifest.sig` (detached Ed25519 signature over the canonical manifest JSON), and `payload/{app, operations, windows, runtime/node?}` mirroring the installer payload shape. The manifest's `files` array lists every shipped file's exact relative path, SHA-256, and size.

### Secure extraction rules (added)

Extraction is a distrustful, ordered pipeline — nothing is trusted until it has been checked, and nothing is checked by trusting file contents before the signature:

1. **Read the zip's central directory only** (no content extraction yet) and locate exactly two required entries: `manifest.json` and `manifest.sig`. Extract only those two into memory.
2. **Verify the manifest signature before trusting anything else in the package.** Canonicalize `manifest.json` exactly as it was signed and verify `manifest.sig` against every currently-trusted update public key (Section 3). If verification fails, or `manifest.json` fails to parse as the expected shape, the package is rejected immediately — no payload entry is ever extracted from an unsigned or invalidly-signed package.
3. **Validate every payload entry's path before extracting it**, for every entry the manifest says it should contain:
   - reject any absolute path (`C:\...`, `\\server\share\...`) or any path not starting with `payload/`;
   - reject any path containing a `..` segment (directory traversal / "zip slip");
   - reject any path that, after case-insensitive NTFS-normalization, collides with another entry's normalized path (duplicate or case-colliding entries — Windows treats `App/Server.js` and `app/server.js` as the same file, which must never be ambiguous);
   - reject the archive outright if it contains any entry **not** present in `manifest.files` ("unexpected entries") or is missing any entry `manifest.files` declares.
4. **Extract only into the controlled release directory** for this exact `toVersion` (`releases\<toVersion>\`, Section 6) — never into `AppRoot` directly, never over any existing release directory, and never over the active release. If `releases\<toVersion>\` already exists from a prior attempt, it is deleted and re-extracted from scratch, never merge-extracted (Section 8's power-loss handling explains why this is always safe).
5. **After extraction, re-walk the actual files on disk and diff them against the manifest**: identical path set (no extra, no missing files actually present), identical SHA-256, identical byte size for every single file. Any mismatch deletes the entire `releases\<toVersion>\` directory and fails the update before any later stage runs.

Only a package that passes every step above is considered "staged and verified" and eligible to proceed to Section 5.

## 3. Signing model (D3 — approved, independence and rotation confirmed)

- A second, fully independent Ed25519 keypair, generated and held exactly like the Phase 33 license key but under its own namespace and its own gitignored private-key file (`.licensing/update-signing-<keyId>.private.pem`, via a new `scripts/updates/generate-update-keypair.ts` mirroring `scripts/licensing/generate-keypair.ts` byte-for-byte in approach).
- `TRUSTED_UPDATE_PUBLIC_KEYS: Record<string, string>` is its own TypeScript module (`src/server/updates/update-public-keys.ts`), structurally disjoint from `TRUSTED_LICENSE_PUBLIC_KEYS` — there is no shared type, no shared constant, and no code path that could pass one where the other is expected.
- **Rotation** is supported the same way as licensing: the map holds `keyId -> public key` for every currently-trusted key, so a new key can be added without invalidating packages already signed under a still-listed prior key, and a compromised/retired key is dropped from the map (a future bootstrap update, Section 6) once no supported package depends on it.
- Because the verifier itself lives in the stable bootstrap component (Section 6), rotating trusted keys is a bootstrap change, not a per-release change — it happens rarely and under tighter control than an ordinary application update.

## 4. Version compatibility (D2 — approved)

Sequential-only: a package's `fromVersion` must exactly equal the currently-active release version; there is no range or skip-ahead support. A customer several versions behind installs each intermediate update in turn. `minimumInstallerSchemaVersion` guards against an installation whose bootstrap predates the update mechanism entirely, directing it to a full reinstall instead.

## 5. Final update sequence (D4 — approved with the requested reordering)

The sequence is fixed and every stage is individually recorded in `update-state.json` (Section 9) before the next stage begins:

1. **Verify package / signature / version** — Section 2's secure-extraction signature check, plus confirming `manifest.fromVersion` equals the currently-active release and `toVersion` is not already an existing release.
2. **Stage and verify payload** — full extraction and per-file re-verification into `releases\<toVersion>\` (Section 2, steps 4-5). Nothing has been stopped or touched yet; the active release keeps serving normally through steps 1-2.
3. **Stop `HamdFoodsERP`** — the existing exact-process-identity `Stop-HamdFoodsManagedRuntime`.
4. **Confirm task/process/listener stopped** — re-check the Scheduled Task state, re-check that no process still owns the configured port, before proceeding. This is a hard gate, not a fire-and-forget stop: step 5's backup must be a true write-quiesced snapshot, so the application must be confirmed fully stopped, not merely asked to stop.
5. **Create + verify the production backup** — `database-backup.mjs create` then `verify`, using the **currently active (old) release's** bundled operations tooling (it is still the active release at this point; Section 6 explains why this matters). Because the app was already confirmed stopped in step 4, this backup reflects exactly the data state the update begins from, with no writes possible after it that the rollback path could ever lose.
   - **If backup or verification fails: restart the unchanged old runtime (the still-active release, nothing yet modified) and abort.** No migration is attempted, no release directory is touched beyond the already-independent `releases\<toVersion>\` staging that simply sits unused.
6. **Apply `migrate deploy`** — against the new release's bundled Prisma client/migrations, run from the bootstrap's stable Node runtime (Section 6). Additive-only, per Section 7's release contract.
7. **Activate the new runtime** — the atomic release-pointer swap (Section 6). The database is now on the new schema; the active pointer now names `toVersion`; the app has still not been started.
8. **Start the task** — `Register-ApplicationTask`/`Start-ScheduledTask`, now pointing (via the bootstrap's `Run-HamdFoodsERP.ps1`, which resolves the active release at every launch) at the newly-activated release.
9. **Health check** — `Wait-Healthy` against `/api/health`. Success marks the update `Complete`. Failure triggers Section 8's rollback policy.

`HamdFoodsERP` remains stopped for the entire window from step 3 through the outcome of step 9 (success, or a completed automatic rollback) — it is never started against a database or release combination that has not been confirmed consistent.

## 6. Release layout and activation (D6 — amended, versioned releases replace the flat layout)

`AppRoot` (`C:\Program Files\HamdFoodsERP`) is restructured:

```text
AppRoot\
  bootstrap\                 -- STABLE. Never replaced by an application update.
    windows\                  Common-, Run-, Update-, Backup-, Account-Recovery-,
                               Dpapi-, Fingerprint-HamdFoodsERP.ps1
    runtime\node\              a pinned Node runtime used only to run bootstrap
                               orchestration and package verification
    operations\
      verify-update-package.mjs   bundles src/server/updates/verify-update-package.ts
                                   and the embedded TRUSTED_UPDATE_PUBLIC_KEYS
  releases\
    0.1.0\
      app\                     Next standalone build
      operations\               seed-all.mjs, bootstrap-super-admin.mjs,
                                 database-backup.mjs, account-recovery.mjs,
                                 bundled Prisma client + prisma/migrations for
                                 that exact release
      windows\                  release-specific copy, kept only for parity
                                 with the current installer payload shape;
                                 the bootstrap copy is authoritative for
                                 anything orchestration-critical
      runtime\node\              this release's required Node version
    0.2.0\
      ... (same shape)
  active-release.json         -- atomic pointer: { "version": "0.2.0", "activatedAt": "..." }
  prerequisites\               (unchanged, installer-only)
```

**Why the split:** the thing that stops the task, takes the backup, runs the migration, and flips the pointer (`Update-HamdFoodsERP.ps1`, running under the bootstrap's own Node) must never itself live inside the directory it is replacing. This is the direct, concrete fix for a failure mode already observed firsthand in this project's own history (a running `node .next/standalone/server.js` process holding its own directory open and blocking a rebuild) — here the stakes are a production customer machine, so the updater is architecturally incapable of locking or being locked out of itself.

**Activation mechanism — the narrowest reliable same-volume operation:** the active release is not chosen by renaming or moving any release directory (those, once extracted and verified, never move again). It is chosen entirely by `AppRoot\active-release.json`, a single small file naming the active version, written with the same atomic temp-file-then-rename pattern already used throughout this codebase (`license-state-store.ts`'s `atomicWrite`, `Save-HamdFoodsProvisioningState`). Activating release `toVersion` is therefore one NTFS metadata-only rename of one small file — strictly narrower than renaming any release's (potentially large) content directories, and with the same power-loss-atomicity guarantee. `bootstrap\windows\Run-HamdFoodsERP.ps1` reads this pointer at every launch to resolve which `releases\<version>\app\server.js` and `releases\<version>\runtime\node\node.exe` to run; a Scheduled Task therefore never needs to be re-pointed at a new path itself, only the pointer file it reads through changes.

Extraction in Section 2 targets `releases\<toVersion>\` directly (no separate staging root distinct from the releases tree) — an unactivated release sitting fully verified on disk is inert and harmless; it only becomes "live" the instant `active-release.json` is rewritten to name it, which is also the single moment Section 5 step 7 represents.

## 7. Schema compatibility and the release contract (D5 — amended)

- Every update ships an explicit, machine-checkable **compatibility declaration** in its manifest: `"previousVersionCompatibleWithNewSchema": true | false`.
- **When `true`** (the normal case, expand/contract discipline followed): the previous release's app code is certified to run correctly against the schema produced by this update's migrations. Automatic app-binary rollback (Section 8) is permitted for this update.
- **When `false`** (a migration that cannot preserve old-app compatibility — expected to be rare and deliberate, e.g. the "contract" half of a two-release expand/contract pair): **automatic binary rollback is prohibited for this specific update.** If the post-update health check fails, the system does not attempt to restart the old binary against the new schema (doing so would be running known-incompatible code against live data). Instead it fails into the stopped, forward-recovery-only worst case described in Section 8 — the same safe-stopped state, just reached directly rather than after a rollback attempt that this manifest has already declared unsafe.
- This turns "does the old app still work against the new schema" from an assumption into a per-release, explicitly declared, build-time fact that the update process reads and obeys — never inferred, never assumed true by default in the risky direction. The declaration itself is signed as part of the manifest (Section 2/3), so it cannot be altered independently of the payload it describes.

## 8. Power-loss / interrupted-update recovery (D7/D8 — approved) and rollback policy

**Rollback policy, stated plainly:**

- **App binary:** automatic rollback to the previous release is attempted on a failed post-update health check **only when** `previousVersionCompatibleWithNewSchema: true` for the update that just ran. It is a pointer-file change back to the previous version — exactly as narrow and atomic as forward activation — followed by task start and another health check.
- **Database schema/data:** never automatically rolled back, in either compatibility case. Forward recovery (leave the new schema in place; simply don't run an app against it yet, or run the old app if certified compatible) is always attempted first and is the terminal state whenever a binary-level answer isn't safe.
- **Guarded backup restore remains the last-resort, operator-confirmed action** for a database judged to be in a bad state — the same existing, explicitly-targeted, never-automatic `backup:restore` procedure, unchanged by this phase.
- **Worst case:** the `HamdFoodsERP` task is left stopped, not crash-looping, with `update-state.json` and `update.log` retaining full detail — a recoverable, inspectable, non-serving state, never a guess.

**Idempotent recovery at every stage** (re-running or auto-resuming the update process after a power loss must be safe to repeat without double-applying anything):

| Interrupted at                               | On-disk state                                                                                                                        | Resume behavior                                                                                                                                                                                                                                                                                                            |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Before stage 1 completes                     | No `update-state.json` yet, or `PackageVerified` not recorded                                                                        | Nothing was stopped, nothing staged is trusted yet. Simply retry from stage 1; any partial `releases\<toVersion>\` from an aborted attempt is deleted and re-extracted (Section 2, step 4), never resumed file-by-file.                                                                                                    |
| Stage 2 (staging) interrupted                | `releases\<toVersion>\` may be partially extracted                                                                                   | The post-extraction hash/size diff (Section 2, step 5) already treats "partial" and "corrupted" identically — it fails, the directory is deleted, and stage 2 restarts cleanly from the still-available, already-signature-verified package.                                                                               |
| Stage 3/4 (stop/confirm-stopped) interrupted | Task may be stopped or mid-stop                                                                                                      | `Stop-ScheduledTask`/the port-owner check are naturally idempotent — re-running stage 3/4 on an already-stopped task is a safe no-op that simply re-confirms the same state.                                                                                                                                               |
| Stage 5 (backup) interrupted                 | A backup may exist without a verified manifest, or verification may not have completed                                               | An unverified/partial backup artifact is never trusted — resume re-runs `create` (a fresh backup id) and `verify` from scratch. Creating an extra unused backup file is harmless; it is not treated as satisfying the gate until its own verification recorded success.                                                    |
| Stage 6 (migration) interrupted              | `_prisma_migrations` may show an incomplete row                                                                                      | `prisma migrate deploy` is idempotent by design — already-applied migrations are skipped on resume. If a specific statement is not resumable this way, recovery falls back to the verified backup from stage 5 via the existing guarded restore, exactly as in the original design's migration-failure handling.           |
| Stage 7 (activation) interrupted             | `active-release.json` still names the old version (the rename either happened or it didn't — no partial pointer state is observable) | Because the pointer write is a single atomic rename, "interrupted" here always means the old pointer is still fully intact. Resume simply re-attempts the same rename; it is naturally idempotent (re-pointing at the same target twice is a no-op the second time).                                                       |
| Stage 8/9 (start/health) interrupted         | Pointer already names the new release; task may or may not be running                                                                | On next boot or resume, the task starts (idempotently) against whatever `active-release.json` currently names, and the health check is simply re-run. A confirmed failure here is the only path that can trigger Section 8's rollback, which is itself the same atomic-pointer-plus-idempotent-restart pattern in reverse. |

## 9. Update-state integrity (added — dedicated key, Phase 33 pattern reused, code shared not duplicated)

- `update-state.json` is protected by the **same code pattern** as Phase 33's `license-state.json` (HMAC-authenticated, key sealed via Windows DPAPI `LocalMachine` scope, generated locally, never embedded) but with a **dedicated key file and dedicated HMAC key material** — `update-state.key`, entirely independent of `license-state.key`. Compromising or losing one never affects the other.
- Implementation-time refactor: the generic protect/authenticate-a-small-JSON-file logic in `src/server/licensing/license-state-store.ts` is extracted into a shared, parameterized primitive (state-file path, key-file path, and data shape all passed in) that both `license-state-store.ts` (re-pointed at it, behavior and tests unchanged) and a new `update-state-store.ts` build on — satisfying "reuse the pattern/code, not the same key material" literally, not just by analogy.
- `update-state.json` records, at minimum: `updateId` (a generated identifier for this specific update attempt), `packageId` (derived from the verified manifest, e.g. a hash of the manifest itself), `fromVersion`, `toVersion`, `currentStage` (one of the nine stages in Section 5, or a terminal outcome), `backupId` (once created), `previousRelease` and `targetRelease` (the two version strings `active-release.json` pointed at / will point at), `migrationCompleted` (bool + timestamp), `activationCompleted` (bool + timestamp), `healthResult` (pass/fail + timestamp), and `rollbackResult` (not-attempted / succeeded / failed / prohibited-by-compatibility-declaration, + timestamp).
- Every write is the same atomic temp-file-then-rename pattern used everywhere else in this design, so `update-state.json` itself can never be observed half-written, mirroring exactly why `active-release.json` is safe.

## 10. Update task security (D9 — approved, constraints incorporated)

- The existing SYSTEM-identity, trigger-less `HamdFoodsERP-Update` Scheduled Task performs the actual work (Section 5), unchanged in identity/model from the original design.
- **The web admin action never hands the Scheduled Task an arbitrary filesystem path.** The flow is: (1) an admin with server-side `updates.manage` uploads a `.hfupdate` file through `/administration/updates`; (2) the server itself (the currently _running_ release's own process — this step is read-only signature/manifest inspection, not a file swap, so it is safe to perform in-process) runs the same secure-extraction and verification pipeline from Section 2 against a temporary location, and on success writes a durable, `updates.manage`-scoped **update record** (a controlled `updateId`) referencing the already-verified, already-staged `releases\<toVersion>\` directory; (3) "Install now" (or a scheduled off-hours trigger, optionally) arms `update-state.json` with that `updateId` and starts `HamdFoodsERP-Update`; (4) the Scheduled Task consumes only that `updateId` — it re-derives everything it needs (which release directory, which manifest) from `update-state.json`/the already-staged release, and independently re-verifies the release's on-disk integrity before doing anything irreversible (defense in depth: the task never simply trusts that what the web process staged is still exactly what it staged).
- `updates.manage` is enforced server-side on every relevant action (`administration/updates/actions.ts`), exactly like `license.manage` — never a client-side-only gate.
- `update-state.json`, `update.log`, and every release/staging directory use the same existing protected-ACL model already applied to `DataRoot\config`/`DataRoot\state` (container-inheriting `SYSTEM + Administrators` only) — no new ACL primitive is introduced.
- Optional off-hours scheduled execution (arm now, run at a configured local time via a one-time Scheduled Task trigger) is supported, using the same trigger-less-task-plus-explicit-arm model already used for on-demand runs — no cloud scheduler, no new always-on trigger.

## 11. License compatibility (D10 — approved)

Unchanged from the prior draft, now explicitly confirmed: license binding is to machine fingerprint and validity window only, never to application version or release identity, and no stage of Sections 5-10 ever reads or writes `license.lic`/`license-state.json`/`license-state.key` (they live under `DataRoot\config`, untouched by anything in `AppRoot`). Update verification, staging, installation, and recovery all run through `updates.manage` and the unrestricted `@/server/auth/server-guards` import, never `licensed-guards.ts` — a legitimate signed update is installable in every one of Phase 33's eight license states, including fully restricted ones, exactly as required.

## 12. Audit/logging

- New `AuditEntityType` value `SOFTWARE_UPDATE`, added the same additive-only way as Phase 33's `LICENSE` value.
- Deliberate, actor-attributable actions (package uploaded/verified, update armed/started, rollback/cleanup confirmed) are written as real `AuditEvent` rows with before/after `update-state.json` stage snapshots.
- Granular stage-by-stage detail (backup id, migration output, activation timing, health-check attempts, rollback outcome) goes to a non-secret `DataRoot\logs\update.log` via the existing `Write-HamdFoodsProvisioningEvent`/`ConvertTo-HamdFoodsSafeLogText` helpers — no new logging primitive.

## 13. Admin UX

- `/administration/updates` (`updates.manage`): shows the active release version, lets an admin upload and verify a package in place (safe, read-only against the running release), then explicitly "Install now" or schedule an off-hours run.
- A persistent status view derived from `update-state.json` (and a shell banner reusing Phase 33's `app-shell.tsx` mechanism) tracks progress through Section 5's nine stages until `Complete` or a resolved rollback, with a link to `update.log`.
- SUPER_ADMIN-only cleanup of a retained previous release directory once satisfied the new one is stable — never automatic deletion.

## 14. Files / schema needed (implementation-time list)

- `prisma/schema.prisma`: one new `AuditEntityType` value (`SOFTWARE_UPDATE`), additive migration only.
- `src/modules/access/domain/permissions.ts`: new `updates.manage`.
- `src/server/updates/{update-public-keys,verify-update-package,manifest,update-state-store}.ts`; a shared `src/server/shared/protected-json-store.ts`-style extraction from Phase 33's `license-state-store.ts` (refactor, behavior-preserving).
- `scripts/updates/{generate-update-keypair,sign-update-package}.ts` (vendor-only tooling, mirrors `scripts/licensing/`).
- New bundled `operations\verify-update-package.mjs`, built into the **bootstrap** payload (a new `stageBootstrap()` step in `scripts/installer.ts`, distinct from today's `stageWindowsScripts()`/`stageOperationalBundles()`, which currently target the flat layout and need reworking for the `bootstrap\` / `releases\<version>\` split).
- `installer/scripts/Update-HamdFoodsERP.ps1` (new, bootstrap-resident) plus updates to `Common-HamdFoodsERP.ps1`, `Run-HamdFoodsERP.ps1`, and `Setup-HamdFoodsERP.ps1` for the new layout, the `active-release.json` pointer, and registering `HamdFoodsERP-Update`.
- `src/app/(erp)/administration/updates/` route + actions.
- `docs/operations/software-updates.md` (parallel to `software-licensing.md`); updates to `docs/operations/windows-installer.md`, `docs/engineering/security.md`, `AGENTS.md`, `docs/README.md`.

## 15. Test plan (for the implementation phase)

- **Domain/unit**: manifest canonicalization/signature verification (valid, tampered, wrong key, wrong `fromVersion`, `previousVersionCompatibleWithNewSchema` both values); secure-extraction path validation (absolute paths, `..` traversal, case-colliding duplicates, unexpected/missing entries); the `update-state.json` stage machine including every row of Section 8's idempotent-resume table.
- **Live-Windows integration**: real zip extraction and secure-extraction rejection cases against real files; real atomic pointer-file activation and rollback; a real bootstrap-vs-release process boundary check (proving the updater process never holds a handle inside the release directory it is replacing); reuse of the `HamdFoodsERP-InstallDrill` (port 3200) identity so this never touches the real task.
- **Update-drill scenarios**: (1) clean successful update end-to-end following the exact nine-stage sequence; (2) forced health-check failure with `previousVersionCompatibleWithNewSchema: true` → automatic rollback restores service, schema stays on the new version, zero data loss; (3) forced health-check failure with the flag `false` → system correctly refuses rollback and fails stopped; (4) simulated power loss at every row of Section 8's table; (5) a deliberately tampered/unsigned package rejected before any extraction; (6) a package with path-traversal/duplicate/unexpected entries rejected during secure extraction; (7) backup-verification failure correctly restarts the unchanged old runtime; (8) update install/verify/recovery exercised in every one of Phase 33's eight license states.
- **Regression**: full existing `pnpm verify`, disposable integration, and disposable E2E suites pass unchanged after every drill scenario.

## Risks

- The bootstrap/release split adds real installer/layout complexity over the flat model; mitigated by the fact that this complexity is exactly what buys the "updater never depends on what it's replacing" guarantee the design requires.
- `previousVersionCompatibleWithNewSchema: false` releases forgo automatic rollback by design — an operator hitting a failed health check on such a release has a shorter automatic safety net (stopped-and-safe, not auto-recovered-and-running); mitigated by this being a deliberate, rare, signed declaration rather than a silent gap, and by the pre-update backup always remaining available as the last-resort path.
- Retaining one previous release after every update grows disk usage across many cycles; bounded to one generation and admin-cleanable, unchanged from the prior draft.
- A truly catastrophic, non-resumable migration failure still requires a full backup restore, which discards writes since that backup — an inherent property of restore-based recovery, not new to this phase.

## D1-D10 status

All ten decisions are **APPROVED**. D4 approved with the reordered nine-stage sequence (Section 5). D5 approved with the explicit, signed, per-release compatibility declaration governing whether automatic rollback is even permitted (Section 7). D6 approved as amended: versioned `releases\<version>\` directories, atomic pointer-file activation, and a stable `bootstrap\` component that lives outside every release (Section 6). D7/D8, D9, D10 approved as originally proposed, with D9's constraints (server-side permission check, controlled `updateId` not an arbitrary path, existing ACL reuse) and D10's confirmation (no license state blocks a legitimate signed update) now made explicit in Sections 10-11. The additional update-state integrity rule (dedicated DPAPI key, shared code not shared key material, full field list, idempotent resume) is incorporated in Section 9.

READY FOR IMPLEMENTATION: NO — design frozen and approved; implementation has not been authorized in this conversation. Do not begin Phase 35.
