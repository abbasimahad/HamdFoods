# Software updates

Phase 34 adds offline, signed software updates for an already-installed, already-licensed customer installation. It does not add a network update check, an auto-update background service, or any outbound call from the running application. Design authority: `docs/specs/phase34-secure-update-recovery-design.md` (D1-D10 approved).

## Model

An update package is a single ordinary ZIP file, `HamdFoodsERP-Update-<toVersion>.hfupdate`, containing `manifest.json` (canonical, unsigned), `manifest.sig` (a detached Ed25519 signature over the canonical manifest), and `payload/{app,operations,windows,runtime/node?}` mirroring the installer payload shape. The manifest lists every shipped file's exact relative path, SHA-256, and size, plus `fromVersion`/`toVersion`, the required Node version, and an explicit `previousVersionCompatibleWithNewSchema` flag.

Signing uses a second, fully independent Ed25519 keypair -- generated and held exactly like the Phase 33 license key, but under its own namespace (`TRUSTED_UPDATE_PUBLIC_KEYS` in `src/server/updates/update-public-keys.ts`, keyed by `keyId` for rotation). The private signing key never enters this repository, the installer payload, or the running application; it is generated and held only by vendor release tooling.

## Install flow

1. From `Administration -> Updates`, an admin with `updates.manage` uploads a `.hfupdate` file. The currently running release verifies the package's signature and manifest in place (read-only; nothing is extracted or installed yet) and, on success, stores the raw bytes under a content-derived `packageId`.
2. **Verify package** reports the `fromVersion -> toVersion` transition and refuses immediately if the package's `fromVersion` does not exactly equal the installed version (sequential-only upgrades -- a customer several versions behind installs each intermediate update in turn), or if the signature/manifest fails validation.
3. **Install now** arms the trigger-less SYSTEM `HamdFoodsERP-Update` Scheduled Task with only a controlled `packageId`/`updateId` (never a filesystem path) and starts it. The web action's own job ends here; the Scheduled Task independently re-verifies the package's integrity before doing anything irreversible.
4. The task runs the fixed nine-stage sequence below. `HamdFoodsERP` remains stopped from the moment the runtime is stopped until a confirmed-consistent outcome (success or a completed automatic rollback) is reached.
5. `Administration -> Updates` shows the last recorded stage, the `fromVersion -> toVersion` transition, and any rollback result, read from `update-state.json`.

Do not power off the machine while an update is running -- every stage is individually recorded and safely resumable, but an actual power loss should still be avoided rather than relied upon.

## The nine-stage sequence

1. **PackageVerified** -- signature, manifest shape, and `fromVersion` match confirmed (again, independently of the web action's earlier check).
2. **PayloadStaged** -- the package is extracted into `releases\<toVersion>\` under strict secure-extraction rules (below), then every extracted file is re-hashed and re-sized against the manifest. The currently active release keeps serving normally through this stage.
3. **RuntimeStopped** -- `HamdFoodsERP` is stopped, identifying the exact listening process by port and by its exact installed `node.exe` path before terminating it.
4. **RuntimeStopConfirmed** -- the task state and the port are re-checked as a hard gate before anything else proceeds, so the following backup is a true write-quiesced snapshot.
5. **BackupVerified** -- a `pg_dump`-based backup is created and verified using the still-active (old) release's own bundled tooling. **If this fails, the unchanged old runtime is restarted and the update aborts (`AbortedBackupFailed`)** -- no migration is attempted and the new release directory is simply left staged and unused.
6. **MigrationApplied** -- `prisma migrate deploy` runs from the new release's bundled Prisma client/migrations. A failure here leaves the task stopped for operator-assisted recovery (`StoppedForRecovery`) rather than guessing.
7. **ReleaseActivated** -- `AppRoot\active-release.json` is rewritten (atomic temp-file-then-rename) to name the new version. This single small-file rename is the entire "cutover"; no release directory is ever renamed or moved.
8. **TaskStarted** -- the task is started; `Run-HamdFoodsERP.ps1` resolves the active release from the pointer at every launch, so nothing needs to be re-pointed at a new path.
9. **HealthVerified** -- `/api/health` is polled for up to 60 seconds. Success marks `Complete`. Failure triggers the rollback policy below.

## Secure extraction

Nothing in a package is trusted until its signature has been verified, and nothing is extracted from an unsigned or invalidly-signed package:

1. Only `manifest.json` and `manifest.sig` are read from the zip first; the manifest signature is verified against every currently-trusted key before anything else is trusted.
2. Every payload entry's path is validated against the verified manifest before extraction: absolute paths, `..` traversal, and entries outside `payload/` are rejected outright; an entry not declared in the manifest, or a manifest entry never delivered, fails the whole package; case-colliding duplicate paths (`App/x` vs `app/x`) are rejected as ambiguous on NTFS.
3. Extraction targets only `releases\<toVersion>\`, never `AppRoot` directly and never over an existing release. A partial prior attempt is deleted and re-extracted from scratch, never merge-extracted.
4. After extraction, every file on disk is re-hashed and re-sized against the manifest; any mismatch deletes the whole staged release directory and fails the update before the runtime is ever touched.

## Release layout

The installer keeps installing into the original flat `AppRoot\{app,operations,windows,runtime}` layout unchanged. Phase 34 adds an optional, lazily-adopted layered layout on top the first time an update actually runs:

```text
C:\Program Files\HamdFoodsERP\
  windows\                 -- never modified by an update (the de facto stable "bootstrap")
  runtime\node\             -- the original flat runtime; superseded per-release once layered
  active-release.json       -- atomic pointer: { "version": "...", "activatedAt": "..." }
  releases\
    0.1.0\{app,operations,runtime\node}
    0.2.0\{app,operations,runtime\node}
```

An installation that has never received an update has no `active-release.json` and keeps running the flat layout exactly as before; every path-resolution function falls back to the flat layout until an update adopts the layered one. `AppRoot\windows` is never touched by an update (only `releases\<version>\` subtrees are created), so it serves as the stable component the update orchestrator itself lives in without being able to lock or corrupt the files it is in the middle of replacing.

## Rollback policy

- **App binary:** automatic rollback to the previous release is attempted on a failed post-update health check **only when** the update's manifest declares `previousVersionCompatibleWithNewSchema: true`. Rollback is the same atomic pointer-file rename in reverse, followed by a task start and another health check.
- **Database schema/data:** never automatically rolled back, in either compatibility case. Migrations are additive-only, matching this project's standing migration discipline.
- **`previousVersionCompatibleWithNewSchema: false`:** automatic rollback is prohibited outright -- a failed health check leaves the task stopped (`StoppedForRecovery`) rather than running an app binary the release has itself declared incompatible with the new schema.
- **Worst case:** `HamdFoodsERP` is left stopped, not crash-looping, with `update-state.json` and `DataRoot\logs\update.log` retaining full stage-by-stage detail. Guarded, operator-confirmed backup restore (`docs/operations/backup-and-recovery.md`) remains the last-resort action for a database judged to be in a bad state; it is unchanged by this phase.

Every stage is individually recorded before the next begins, so re-running or auto-resuming after a power loss is safe at any point: a partially staged release is deleted and re-extracted, an unverified backup is never trusted and is retaken from scratch, `prisma migrate deploy` is naturally idempotent, and the pointer-file rename either fully happened or it didn't (no partial state is observable).

## Update-state integrity

`update-state.json` is protected by the same DPAPI/HMAC pattern as Phase 33's `license-state.json` (`src/server/shared/protected-json-store.ts`, generalized out of `license-state-store.ts` so both callers reuse the code without sharing key material), but with its own dedicated key file (`update-state.key`) and dedicated HMAC key -- compromising or losing one never affects the other. It records the update id, package id, `fromVersion`/`toVersion`, current stage, backup id, migration/activation timestamps, health result, and rollback result. `DataRoot\logs\update.log` carries the non-secret, sanitized stage-by-stage narrative for troubleshooting.

## License compatibility

License binding is to machine fingerprint and validity window only, never to application version or release identity. No stage of the update process ever reads or writes `license.lic`/`license-state.json`/`license-state.key`. `Administration -> Updates` is enforced through the ordinary unrestricted `@/server/auth/server-guards` import, not `licensed-guards.ts` -- a legitimate signed update is installable in every license state, including fully restricted ones, so a licensing problem can always be fixed by the very update that resolves it.

## Audit/logging

Deliberate, actor-attributable actions (package uploaded/verified, update armed/started) are written as `AuditEvent` rows under the `SOFTWARE_UPDATE` entity type, added the same additive-only way as Phase 33's `LICENSE` value. Granular per-stage detail lives in the non-secret `DataRoot\logs\update.log`.

## Vendor tooling (not part of the shipped application)

- `pnpm tsx scripts/updates/generate-update-keypair.ts <keyId>` -- generates a new Ed25519 keypair fully independent of the license-signing keypair; writes the private key to the gitignored `.licensing/update-signing-<keyId>.private.pem` and prints the public key to paste into `update-public-keys.ts`.
- `pnpm tsx scripts/updates/sign-update-package.ts --payload-dir <dir> --private-key <path> --key-id <keyId> --from-version <x.y.z> --to-version <x.y.z> --node-version <version> --schema-compatible true|false [--node-runtime-included] --notes "<summary>" --out <name>.hfupdate` -- hashes every file under `<payload-dir>/payload/`, builds and signs the manifest, and zips the package. `payload-dir` must contain a `payload/` subdirectory shaped exactly like the installer payload (`payload/app`, `payload/operations`, `payload/windows`, optionally `payload/runtime`).

## Known gaps

The design's optional off-hours scheduled install trigger and the SUPER_ADMIN-only cleanup action for a retained previous release directory (Section 10/13 of the design) are not yet implemented; only immediate "Install now" is available, and every staged/activated release version is retained indefinitely under `releases\` with no automatic or admin-facing pruning.

## Verification evidence

A live-Windows update drill (isolated `HamdFoodsERP-InstallDrill` environment, port 3200) exercised every scenario in the design's test plan with real signed `.hfupdate` packages and a real bundled Prisma engine for the migration cases: successful end-to-end updates; an untrusted-key signature rejected before extraction; a payload tampered after signing rejected at post-extraction hash verification; a wrong-`fromVersion` manifest rejected by the orchestrator's independent re-check; a path-traversal zip entry rejected with nothing written outside staging; a backup failure that restarted the unchanged old runtime; a genuine PostgreSQL syntax error in a new migration caught and left safely stopped with a verified backup available; a compatible-schema health failure that automatically rolled back; an incompatible-schema health failure that correctly stayed stopped instead of rolling back; and orchestrator kills at several points in the sequence that each resumed idempotently with exactly one backup and no duplicated migration or activation. See `docs/phases/current.md`'s Phase 34 section for the full evidence record, including two real defects found and fixed during this drill.
