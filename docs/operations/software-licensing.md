# Software licensing

Phase 33 adds offline, signed-license protection to the native Windows installation. It does not add a license server, a cloud dependency, or any network call from the running application.

## Model

A license is a JSON payload plus a detached Ed25519 signature (`license.lic`), bound to one machine's non-secret hardware fingerprint (SHA-256 of the OS `MachineGuid` and the `C:\ProgramData` volume's serial number). The application embeds only the vendor's **public** key(s) (`src/server/licensing/public-keys.ts`, keyed by `keyId` for rotation); the private signing key never enters this repository, the installer payload, or the running application. It is generated and held only by vendor release tooling (`scripts/licensing/generate-keypair.ts`, writing to the gitignored `.licensing/` directory).

## Activation flow

1. From `Administration -> License`, generate an activation request. This writes `activation-request.json` (containing only the non-secret machine fingerprint) to the installation's protected config directory.
2. Send that file to Hamd Foods out-of-band (email, USB -- no network call from the ERP itself).
3. The vendor signs a `.lic` file for that exact fingerprint using `scripts/licensing/sign-license.ts` and the private key.
4. Import the signed `.lic` from `Administration -> License`. The runtime verifies it locally, forever -- no further contact with the vendor is required.

A fresh installation without a license runs fully functional for a 14-day setup grace period. An expired license enters a 30-day grace period before restriction. Both windows, plus a 15-minute clock-rollback tolerance, are enforced from `src/modules/licensing/domain/license.ts` and are described exactly in `docs/specs/phase33-software-protection-design.md`.

## Restricted mode

Restricted mode blocks only ordinary business mutations (purchasing, production, sales, inventory, accounting, administration). Login/logout, every read-only page, reports, printing/export, backups, restore tooling, account recovery, and the License panel itself always remain available -- licensing failure never corrupts, encrypts, or deletes business data. See the Phase 33 design's Section 9 for the exact state table (`SETUP_GRACE`, `VALID`, `EXPIRY_GRACE`, `EXPIRED`, `MACHINE_MISMATCH`, `INVALID_SIGNATURE`, `TAMPERED_STATE`, `CLOCK_ROLLBACK`).

Enforcement is composed alongside authorization: `src/server/auth/licensed-guards.ts` wraps `requirePermission`/`requireAnyPermission` for mutation entry points only (every `actions.ts` file except `account/security` and `administration/license`, which must remain available for account hygiene and license recovery respectively). Every `page.tsx` in the application continues to import the unrestricted guards directly, so reads are never affected by license state by construction, not by convention.

Licensing is enforced only when `APP_ENV=production` on Windows, matching every other native-production-only invariant in `src/server/env.ts`. Development, test, CI, and any non-Windows environment always evaluate as unrestricted.

## Local state protection

`license-state.json` (grace-period anchors and the clock-rollback watermark) is authenticated with an HMAC keyed by a key sealed via Windows DPAPI (`LocalMachine` scope). The key is generated locally on first use and never embedded or transmitted. Both files live under the already ACL-protected `<DataRoot>\config` directory (SYSTEM + Administrators only). Deleting, copying between machines, or hand-editing either file resolves to `TAMPERED_STATE` (restricted, but recoverable), never to silently trusting altered data.

## Recovery

- **Corrupted local state** (`TAMPERED_STATE`, `CLOCK_ROLLBACK`): a `license.manage` holder can reset local state metadata from the License panel. This clears only the unsigned local cache and forces re-verification of the still-valid signed `.lic` file; it cannot edit a signed field or rebind a license to different hardware.
- **Hardware replacement**: requires a newly vendor-signed license (repeat the activation flow). There is no local or administrative way to rebind an existing `.lic` to a different machine.
- **Reinstall/repair on the same machine**: `Setup-HamdFoodsERP.ps1 -Mode Repair` leaves `license.lic` and `license-state.json` untouched; a same-machine reinstall recomputes an identical fingerprint and verifies transparently.
- **Disaster recovery to different hardware**: license files are deliberately excluded from PostgreSQL backups (`docs/operations/backup-and-recovery.md` backs up only the database). Restore the database per the existing guarded procedure, then obtain a newly signed license for the new machine.

## Installer

`Setup-HamdFoodsERP.ps1` accepts an optional `-LicenseFile` parameter that stages a pre-supplied `.lic` into the protected config directory (same ACL treatment as `.env.production`). Its absence is never a setup failure -- the application enters `SETUP_GRACE`. The primary intended flow is activation-after-install via the License panel, not a pre-supplied file.

## Vendor tooling (not part of the shipped application)

- `pnpm tsx scripts/licensing/generate-keypair.ts <keyId>` -- generates a new Ed25519 keypair; prints the public key to paste into `public-keys.ts` and writes the private key to `.licensing/<keyId>.private.pem` (gitignored, never committed).
- `pnpm tsx scripts/licensing/sign-license.ts --activation-request <path> --private-key <path> --key-id <keyId> --customer "<name>" [--expires-at <ISO date>] --out <path>` -- signs a customer's activation request into a `.lic` file.
