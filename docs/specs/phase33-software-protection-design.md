# Phase 33 — Software Licensing / Protection Design

Status: **DESIGN FROZEN (D1-D7 APPROVED WITH AMENDMENTS) — NOT IMPLEMENTED**. Target: customer-installed copies of Hamd Foods ERP running as a native Windows Scheduled Task, licensed per factory installation.

## 1. Current deployment model (grounding)

- Native Windows install via Inno Setup (`installer/HamdFoodsERP.iss`), `PrivilegesRequired=admin`. Payload goes to `C:\Program Files\HamdFoodsERP` (immutable app code); mutable state (config, backups, logs, provisioning state) goes to `C:\ProgramData\HamdFoodsERP`, ACL-locked to `SYSTEM` + `Administrators` only (`Protect-HamdFoodsPath` in `Common-HamdFoodsERP.ps1`, enforced both as a file ACL and re-verified before every trust decision via `Test-HamdFoodsRestrictedPath`).
- `Setup-HamdFoodsERP.ps1` is a staged, idempotent, resumable provisioner (`provisioning-state.json`, `CompletedStages`) that requires an elevated Administrator token (`Test-HamdFoodsAdministrator`), generates `DATABASE_URL` password and `BETTER_AUTH_SECRET` via CSPRNG (`New-RandomHex` → `RandomNumberGenerator`), writes `.env.production`, applies migrations, seeds, bootstraps the first SUPER_ADMIN interactively, registers a SYSTEM-level Scheduled Task (`HamdFoodsERP`, `AtStartup`, `RunLevel Highest`), and starts/health-checks it.
- `src/server/env.ts` / `parseNativeProductionEnv` is the authoritative runtime guard: in `APP_ENV=production` it hard-fails unless PostgreSQL, `HOSTNAME`, and `BETTER_AUTH_URL` are loopback (or an exact `*.ts.net` Tailscale origin per `BETTER_AUTH_TRUSTED_ORIGINS`), `AUTH_BYPASS_ENABLED` is off, and origins are exact (no wildcard). This same module — env validated at process start, fail-closed with actionable non-secret errors — is the natural home for a new licensing gate.
- Better Auth (`src/server/auth/auth.ts`) owns authentication entirely; `provisioningAuth` (signup-enabled) is never mounted as an HTTP handler — only used by the bootstrap script. RBAC is resolved server-side per request from PostgreSQL (`PermissionCode`/`Role`/`RolePermission`).
- `docs/engineering/security.md` codifies: PostgreSQL never reachable from the browser; secrets only in ignored local env files; least privilege; local account recovery is an elevated, high-integrity-token-gated (`isAdministratorHighIntegrity`: `S-1-5-32-544` **and** `S-1-16-12288`/`16384`) offline Windows utility with no master/universal password and no remote reset API.
- Backup/restore (`docs/operations/backup-and-recovery.md`) is fully offline/local: `pg_dump --format=custom` to `.backups/` (or `BACKUP_DIRECTORY`), SHA-256-verified manifests, a guarded restore that only targets an explicit `*restore*test*` database. No cloud integration exists anywhere in the product today.
- Tailscale (`docs/operations/tailscale-private-access.md`) is optional, private, tailnet-only HTTPS ingress — never a public endpoint, never an identity/authorization source, and explicitly **not required** for local operation. Licensing must remain fully independent of Tailscale.
- `scripts/production.ts` is the single command surface (`build|start|migrate|seed|bootstrap|backup|health|preflight|validate`) invoked identically by both `pnpm production:*` and the installed runtime (via the bundled Node, called from `Common-HamdFoodsERP.ps1`'s `Invoke-HamdFoodsNode`). The licensing gate sits on this same startup path so both routes are covered without duplicating logic.

**Conclusion (unchanged):** licensing is built as an additional module using the product's existing seams — a fail-closed boot-time gate (`env.ts`), a protected ProgramData secret store with proven ACL discipline, and a fully offline-capable customer machine — not a parallel system.

## 2. Final license model (D1 — APPROVED)

Ed25519-signed license file, canonical JSON payload, detached signature.

```json
{
  "payload": {
    "payloadVersion": 1,
    "keyId": "string — identifies which vendor public key verifies this signature",
    "licenseId": "uuid",
    "customer": "string",
    "issuedAt": "ISO-8601",
    "expiresAt": "ISO-8601 | null",
    "machineFingerprint": "string — REQUIRED for production licenses, see Section 3"
  },
  "signature": "base64 Ed25519 signature over the canonical (stable-key-order, no-whitespace) JSON encoding of payload"
}
```

- **Canonical payload:** the signature is computed over a deterministic serialization (fixed key order, no insignificant whitespace, UTF-8) so verification is byte-exact and reproducible — the same discipline the codebase already applies to exact-decimal/immutable-snapshot data elsewhere (e.g. Purchase Invoice line snapshots).
- **`payloadVersion`:** allows the payload shape to grow additively later (mirrors `provisioning-state.json`'s `SchemaVersion` pattern already in the installer).
- **`keyId`:** the verifier holds a small map of `keyId → trusted Ed25519 public key`, enabling key rotation (Section 11) without invalidating already-issued licenses signed under a prior key, as long as that prior key remains listed as trusted.
- **Private signing key:** never enters this repository, the installer payload, any customer runtime, or any log — it is exclusively a vendor-side, offline release-process asset, generated and held outside this codebase entirely. No script, test, or CI process in this repository ever handles it. Only the **public** key(s) are embedded in the shipped binary (`src/server/licensing/public-keys.ts`), which is not a secret-exposure concern — public keys are designed to be public.
- License files are placed at `C:\ProgramData\HamdFoodsERP\config\license.lic`, protected by the same `Protect-HamdFoodsPath` ACL mechanism already used for `.env.production` (SYSTEM + Administrators only). No new privilege model is introduced.

## 3. Activation and machine binding (D2 — AMENDED)

Production licenses are **always** signed for one specific machine fingerprint. There is no reusable unbound production license and no independent first-run self-binding.

**Activation flow:**

1. On a fresh installation (or explicit "Generate activation request" admin action), the ERP computes its non-secret machine fingerprint (Section 3.1) and writes an **offline activation request** file — a small, unsigned JSON document containing the fingerprint, installation identifiers, and a timestamp — to a location the operator can retrieve (e.g. `C:\ProgramData\HamdFoodsERP\config\activation-request.json`, exportable from the admin UI).
2. The operator sends this request to the vendor out-of-band (email/USB — no network call from the ERP itself).
3. The vendor signs a `.lic` file **externally** (outside this repository, using the private key), embedding that exact `machineFingerprint` into the signed payload.
4. The customer imports the signed `.lic` file through the admin UI or by placing it at `config\license.lic` (installer-assisted, Section 8).
5. The runtime verifies the license **locally, forever** — signature validity, expiry, and an exact match between the signed `machineFingerprint` and the machine's current, freshly recomputed fingerprint. No license server, no network call, ever.

### 3.1 Fingerprint composition (unchanged from prior draft, now purely an input to the signed payload rather than a local-binding record)

Non-secret, stable fingerprint derived from durable Windows identifiers readable without elevation: SHA-256 of the OS `MachineGuid` (`HKLM\SOFTWARE\Microsoft\Cryptography\MachineGuid`) combined with the primary volume's `VolumeSerialNumber` for the drive hosting `C:\ProgramData`, truncated to a fixed-length hex string. Raw components are never displayed or logged beyond the derived fingerprint; the admin UI shows only a masked form.

### 3.2 Hardware replacement

Hardware replacement (disk swap, motherboard replacement, migration to new hardware) changes the fingerprint and therefore **requires a newly vendor-signed license** — the activation flow above is repeated from step 1. There is no local, automatic, or SUPER_ADMIN-driven way to rebind an existing signed license to a new fingerprint; that would defeat the purpose of binding the signature itself.

### 3.3 What SUPER_ADMIN may and may not do

SUPER_ADMIN (via `license.manage`, Section 7 of D7) may:

- Generate/export a new activation request.
- Import/replace a signed `.lic` file.
- Reset **corrupted local binding/state metadata** — i.e., the unsigned, locally-derived operational state (`license-state.json`: cached verification result, grace-period timestamps, rollback watermark) when that file is unreadable or fails its own integrity check (Section 4/6) — this clears a broken local cache and forces a fresh verification pass against the still-valid signed `.lic`, it does **not** touch the signed file itself.

SUPER_ADMIN may **not**:

- Edit, override, or locally regenerate the `machineFingerprint` inside a signed license.
- Cause an already-issued `.lic` to be treated as valid for a different machine.
- Extend an expired license, change its `expiresAt`, or otherwise mutate any signed field — the signature makes any such edit self-evidently invalid, and no admin action attempts to bypass that check.

This distinction — resettable _unsigned local cache_ vs. immutable _signed payload_ — is the same "content-field-immutability once posted" discipline already used throughout the ERP's domain models (e.g. posted Purchase Invoice lines), applied here to license data.

## 4. Grace / clock policy (D3 — APPROVED)

| Condition                                                                 | Policy                                                                                                                                                                                                       |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Fresh installation, no license imported yet                               | **14-day setup grace** from first successful provisioning (anchored to the existing tamper-resistant `provisioning-state.json` timestamp), fully functional with a persistent non-blocking banner.           |
| Valid license past `expiresAt`                                            | **30-day expiry grace**, restricted mode (Section 6) begins immediately at day 0 of the grace window with a countdown banner; hard restriction resumes only if the 30 days elapse without a renewed license. |
| Clock rollback detected                                                   | **15-minute tolerance** (NTP/DST jitter); beyond that, immediate restriction — see Section 4.1. No grace extension is ever computed from a clock found to be rolled back.                                    |
| Invalid signature, tampered license file, or machine-fingerprint mismatch | **Restricted immediately — no grace period of any kind.** These are not "waiting for renewal" conditions; they indicate the artifact itself cannot be trusted, so there is nothing to extend.                |

### 4.1 Protecting grace/state dates against deletion or rollback

The 14-day and 30-day windows are computed from anchors that resist the obvious attacks:

- The setup-grace anchor is the existing `provisioning-state.json` first-completion timestamp, itself DPAPI/HMAC-protected per Section 5 — deleting `license-state.json` does not reset the setup-grace clock, because the anchor lives in provisioning state, not license state.
- The expiry-grace anchor is **first-observed-expired** timestamp, written into the DPAPI-protected `license-state.json` (Section 5) the first time the runtime notices `expiresAt` has passed, and never rewritten thereafter. Deleting or rolling back `license-state.json` triggers `TAMPERED_STATE`/`CLOCK_ROLLBACK` handling (Section 9 state table) rather than silently re-granting a fresh 30 days.
- Because the integrity key protecting this state is itself sealed to the local machine via Windows DPAPI (`LocalMachine` scope, Section 5), copying `license-state.json` to another machine to "reset the clock" produces an unreadable/invalid file there too, which resolves to `TAMPERED_STATE`, not a fresh grace period.

## 5. Anti-tamper scope (D4 — APPROVED)

**In scope:**

- Ed25519 signature verification of the license payload (primary defense — any edit to a signed field invalidates it regardless of how the file is modified).
- Reuse of the existing ProgramData ACL discipline (`Protect-HamdFoodsPath`) for `license.lic` and `license-state.json` — tampering requires local Administrator, consistent with the rest of the product's trust boundary.
- Clock-rollback detection (Section 4.1 / Section 9).
- Protected local state: `license-state.json`'s integrity is authenticated with an **HMAC keyed by a key protected via Windows DPAPI, `LocalMachine` scope** (`CryptProtectData`/`ProtectedData.Protect` with no additional entropy beyond the DPAPI machine scope, so any process running as SYSTEM/Administrator on _this_ machine can unprotect it, but the file is meaningless if copied elsewhere). **No HMAC secret is embedded in the binary or repository** — the key material is generated locally on first use, stored DPAPI-sealed, and never leaves the machine. This directly satisfies "no hardcoded secrets."

**Explicitly out of scope:** binary obfuscation, anti-debugging, VM/sandbox detection, kernel-level protection. As previously reasoned: a local Administrator on a machine they physically or administratively control cannot be stopped by software-only measures, and this product's threat model (single-factory ERP, not mass-market anti-piracy) does not justify measures that risk misfiring against a legitimate operator — directly protecting the "no destructive lockout" hard requirement.

## 6. Restricted mode (D5 — APPROVED)

Restricted mode blocks **ordinary business mutations only**. It is computed once at boot alongside `serverEnv` and enforced as an additional, orthogonal check in the existing server-action authorization path (`server-guards.ts`) — never a change to `PermissionCode`/RBAC semantics, never data-destructive.

**Always available, regardless of license state:**

- Login/logout and all normal authentication flows.
- All read-only pages across every module.
- Reports (financial and operational).
- Printing/export of any document or report.
- Backups (`backup:create`/`list`/`verify` and the Scheduled backup task) — a licensing fault must never stop the safety net that protects the customer's data.
- Recovery/restore tooling (`backup:restore`, the guarded restore path).
- Account recovery (the offline elevated Windows utility) — remains fully independent of license state, since it may be needed to regain admin access in order to _fix_ a licensing problem.
- License status viewing.
- License installation/replacement and activation-request generation (Section 3) — the system must always be able to accept the fix for its own restricted condition.

**Blocked while restricted:** create/edit/post/cancel/reverse-style mutations across purchasing, production, sales, inventory adjustments, accounting entries, and administration — i.e., anything that changes business state — return a generic, non-internal message: "This installation is not licensed. Contact Hamd Foods to activate." (matches the existing rule against leaking verification internals into user-facing output).

**Absolute guarantees carried over unchanged:** no inventory/accounting corruption, no encryption of any data, no deletion of any data, no ransom-style behavior, under any license state.

## 7. Backup/restore interaction (D6 — APPROVED)

- `license.lic` and `license-state.json` remain **outside PostgreSQL and outside database backups** entirely — `database-backup.ts` continues to back up only the database, unchanged. This is deliberate: license state is host-local and must never be silently transplanted onto different hardware via a database restore.
- **Repair mode** (`Setup-HamdFoodsERP.ps1 -Mode Repair`) leaves an existing `license.lic` and `license-state.json` untouched, exactly like it already does for `.env.production`.
- **Same-machine reinstall** (ProgramData preserved or the same physical/virtual machine) recognizes the existing license file automatically — the fingerprint recomputes identically, verification succeeds, no operator action needed.
- **Disaster recovery to different hardware** requires a **newly vendor-signed license** (the activation flow in Section 3 repeats) — this is now the sole path for any machine change, superseding the earlier draft's local self-binding idea.

## 8. Installer integration

- `Setup-HamdFoodsERP.ps1` gains an optional, non-blocking license-staging step: if a `license.lic` is supplied alongside the installer (or via a new `-LicenseFile` parameter), it is copied to `config\license.lic` and ACL-protected before `RuntimeStartup`, mirroring `.env.production` exactly. If absent, installation completes normally and the system enters `SETUP_GRACE` (Section 9).
- A new, equally non-blocking capability lets the installer (or a first-run admin action) emit the **activation request** file described in Section 3, so an operator with no pre-supplied license can still generate the request needed to obtain one — licensing is never a hard blocker to completing installation.
- No change to the Inno Setup `.iss` trust model (`PrivilegesRequired=admin`, ACL-protected ProgramData) — license files ride the same rails already audited for `.env.production`.

## 9. License states (D7 — states defined)

Exactly eight states. `mutationAllowed` reflects Section 6's blocked/allowed rule; every state still allows the Section 6 "always available" set.

| State               | Meaning                                                                                                                | Mutations                         | Banner / status shown                                                                                                                                       | Audit behavior                                                                                                                                                     | Recovery path                                                                                                                                            |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------- | --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SETUP_GRACE`       | No license imported yet; within the 14-day post-provisioning window                                                    | **Allowed**                       | Persistent, dismissible-per-session banner: "Unlicensed — N days remaining in setup grace."                                                                 | `LICENSE_STATE_CHANGED` on entry (install time) and on exit (either to `VALID` via import, or to `EXPIRED`-style hard restriction if the window lapses unlicensed) | Import a signed `.lic` (Section 3) or generate/send an activation request                                                                                |
| `VALID`             | Signature valid, not expired, fingerprint matches                                                                      | **Allowed**                       | No banner, or a quiet "Licensed to `<customer>`, valid until `<date>`" in the license panel only                                                            | `LICENSE_STATE_CHANGED` on entry only (transition into VALID)                                                                                                      | —                                                                                                                                                        |
| `EXPIRY_GRACE`      | Valid signature/fingerprint, `expiresAt` passed, within 30-day grace                                                   | **Allowed**                       | Prominent countdown banner: "License expired — N days remaining before restriction. Contact Hamd Foods to renew."                                           | `LICENSE_STATE_CHANGED` on entry; daily re-affirmation not logged (avoid audit-log noise)                                                                          | Import a renewed signed `.lic`                                                                                                                           |
| `EXPIRED`           | `EXPIRY_GRACE` window elapsed without renewal                                                                          | **Blocked**                       | Persistent restriction banner: "This installation is not licensed. Contact Hamd Foods to activate."                                                         | `LICENSE_STATE_CHANGED` on entry                                                                                                                                   | Import a renewed signed `.lic` (returns to `VALID`)                                                                                                      |
| `MACHINE_MISMATCH`  | Signature valid, not expired, but fingerprint does not match this machine                                              | **Blocked immediately, no grace** | Restriction banner naming the condition ("License is bound to different hardware. Contact Hamd Foods for a new license.") without exposing raw fingerprints | `LICENSE_STATE_CHANGED` on entry                                                                                                                                   | New vendor-signed license for this machine's fingerprint (Section 3.2)                                                                                   |
| `INVALID_SIGNATURE` | License file present but signature does not verify under any trusted `keyId`                                           | **Blocked immediately, no grace** | Generic restriction banner; never reveals _why_ verification failed beyond "invalid license" (avoids giving a tampering roadmap)                            | `LICENSE_STATE_CHANGED` on entry                                                                                                                                   | Replace with a valid signed `.lic`                                                                                                                       |
| `TAMPERED_STATE`    | `license-state.json` fails its DPAPI/HMAC integrity check (missing, corrupted, copied from another machine, or edited) | **Blocked immediately, no grace** | Restriction banner: "License state could not be verified. Contact an administrator."                                                                        | `LICENSE_STATE_CHANGED` on entry; SUPER_ADMIN-initiated reset (Section 3.3) also audited                                                                           | SUPER_ADMIN resets local state metadata (Section 3.3), which forces re-verification of the still-valid signed `.lic` from scratch                        |
| `CLOCK_ROLLBACK`    | System clock behind the protected last-observed-time watermark by more than 15 minutes                                 | **Blocked immediately, no grace** | Restriction banner: "System clock inconsistency detected. Correct the system clock and contact an administrator if this persists."                          | `LICENSE_STATE_CHANGED` on entry and on resolution                                                                                                                 | Correct the system clock forward past the watermark; if it recurs, SUPER_ADMIN state reset (Section 3.3) after confirming the clock is genuinely correct |

State evaluation order at boot: `TAMPERED_STATE` and `CLOCK_ROLLBACK` are checked before signature/expiry/fingerprint logic (an untrustworthy state file or clock invalidates the basis for evaluating grace windows at all), then `INVALID_SIGNATURE` → `MACHINE_MISMATCH` → expiry/grace math → `VALID`/`SETUP_GRACE`.

## 10. RBAC (D7 — `license.manage`)

- New `PermissionCode`: `license.manage`, added to `src/modules/access/domain/permissions.ts` alongside `settings.manage`, following the identical convention.
- Granted through the normal RBAC system — assignable to any role via Roles & Permissions, **including SUPER_ADMIN**, which is granted it by default the same way `settings.manage` is today. No hardcoded role-name check is introduced; ordinary permission-code authorization applies (per `docs/engineering/security.md`'s existing rule that SUPER_ADMIN role-name checks exist only for its own explicit preservation invariants, not general features).
- **Explicit enforcement exemption:** the minimum license-management operations — viewing license status, generating an activation request, importing/replacing a `.lic` file, and (for the `TAMPERED_STATE`/`CLOCK_ROLLBACK` recovery path) resetting local state metadata — are exempted from the mutation-blocking check itself, gated only by `license.manage`, never by license state. This is what makes recovery from every restricted state in Section 9 actually possible without a chicken-and-egg lockout.

## 11. Update compatibility

- `payloadVersion` allows additive payload evolution without breaking already-issued licenses.
- Application version upgrades never require a new license — binding is to hardware fingerprint + validity window, not to a build.
- The verifier holds a `keyId → public key` map (not a single key), so a key rotation ships a new trusted key while continuing to honor licenses signed under a still-listed prior `keyId` until they naturally expire — no forced mass re-issuance on rotation.

## 12. Admin UX

- `Administration → License` panel, gated by `license.manage`: current state (one of the eight in Section 9), customer/edition, `issuedAt`/`expiresAt`, masked machine fingerprint (last 6 characters only), days remaining where applicable, and the audit history of state changes.
- SUPER_ADMIN (or any `license.manage` grantee) actions: generate/export activation request; import/replace signed `.lic`; reset local state metadata (only surfaced/enabled when the current state is `TAMPERED_STATE` or `CLOCK_ROLLBACK`, to avoid it being mistaken for a general-purpose override).

## 13. Security boundaries

- Public verification keys: bundled, non-secret, embedded as literals (`keyId → key` map).
- Private signing key: never present anywhere in this repository, installer, or shipped artifact — exclusively a vendor-side, offline release asset.
- DPAPI-protected local integrity key: generated locally, sealed with `LocalMachine` scope, never embedded, never transmitted, never logged.
- No new network egress anywhere — licensing is 100% local verification with an out-of-band (email/USB) activation exchange, preserving the "no permanent cloud dependency" requirement and leaving Tailscale's private-access-only posture untouched.
- No change to Better Auth, RBAC semantics, or the PostgreSQL-loopback-only boundary — licensing composes alongside `server-guards.ts` as an orthogonal gate.
- Raw fingerprint components, DPAPI key material, and HMAC values are never logged; only the masked fingerprint and the named state (Section 9) appear in UI/audit data, consistent with `ConvertTo-HamdFoodsSafeLogText`-style redaction already used by the installer scripts.

## 14. Schema / files needed (implementation-time list, not created in this turn)

- `prisma/schema.prisma`: no new required table for the core license check (must not depend on DB reachability at boot). Add one new `AuditEntityType` value (`LICENSE`).
- `src/modules/access/domain/permissions.ts`: add `license.manage`.
- `src/server/licensing/public-keys.ts` — embedded `keyId → trusted public key` map.
- `src/server/licensing/license-verification.ts` — pure signature/expiry/fingerprint/state-machine logic (domain layer, unit-testable without I/O).
- `src/server/licensing/license-state-store.ts` — DPAPI/HMAC-protected `license-state.json` read/write.
- `src/server/licensing/machine-fingerprint.ts` — Windows fingerprint derivation.
- `src/server/licensing/activation-request.ts` — activation-request generation.
- Extend `src/server/env.ts` (or a sibling module loaded alongside it) with boot-time state evaluation, and `server-guards.ts` with the mutation-blocking + exemption check (Section 10).
- `installer/scripts/Setup-HamdFoodsERP.ps1` — optional license-file staging (Section 8).
- New `src/app/(erp)/administration/license/` route (Section 12).
- Documentation: new `docs/operations/software-licensing.md`; updates to `docs/engineering/security.md`, `AGENTS.md`, `docs/README.md` at implementation time.

## 15. Test changes (for the implementation phase)

- **Domain unit tests:** valid signature accepted; tampered payload rejected under every `keyId`; expired/not-yet-valid `expiresAt` windows; fingerprint match vs. `MACHINE_MISMATCH`; all eight states reachable and correctly prioritized in the boot evaluation order (Section 9); grace-window boundary arithmetic (day 13/14/15 of setup grace, day 29/30/31 of expiry grace); 15-minute clock-rollback tolerance boundary; multi-`keyId` verifier accepts old-and-new keys post-rotation.
- **Application-layer tests:** restricted-mode computation from each of the eight states; the Section 10 exemption list is exhaustively exercised (license-management actions succeed in every restricted state; every other mutation is blocked in every restricted state).
- **Integration tests (disposable DB):** mutation routes blocked while restricted except the exempted license-management ones; read/report/print/export/backup/restore/account-recovery routes unaffected in every state; `LICENSE_STATE_CHANGED` audit events written for every transition in Section 9's table; SUPER_ADMIN local-state reset only available/effective in `TAMPERED_STATE`/`CLOCK_ROLLBACK`; explicit assertion that no licensing operation ever touches inventory/accounting/GL tables; DPAPI-protected state is unreadable/rejected when copied between machines (simulated).
- **E2E:** banner wording and visibility per state; blocked-mutation generic message; admin activation-request/import/reset flow; `license.manage` gating (present vs. absent) independent of SUPER_ADMIN role name; license panel masked-fingerprint display.
- **Installer-level (manual/drill):** fresh install with pre-supplied bound license → `VALID` immediately; fresh install without one → `SETUP_GRACE` banner; repair preserves existing license/state untouched; simulated hardware fingerprint change on an existing install → `MACHINE_MISMATCH`, resolved only by a newly signed license.

## Risks

- Local-Administrator-with-full-machine-control can still defeat any purely local check (stated plainly, not overclaimed) — accepted for this single-factory-ERP threat model per explicit approval of D4's scope.
- 15-minute clock-rollback tolerance can still false-positive on unusually large legitimate clock corrections (e.g., dead CMOS battery) — mitigated by the state resolving to a clear, non-destructive, admin-recoverable `CLOCK_ROLLBACK` state rather than any punitive action.
- Requiring a newly vendor-signed license on every hardware replacement (D2 amendment) is a deliberate strictness/security tradeoff over the earlier self-binding draft — it removes the "unbound license copied to another PC self-binds" risk entirely, at the cost of vendor turnaround time being on the critical path for legitimate hardware swaps; accepted as approved.
- DPAPI `LocalMachine` scope ties `license-state.json` to the OS install, not just the hardware — a same-hardware OS reimage will also invalidate the local state (correctly resolving to `TAMPERED_STATE`, recoverable via SUPER_ADMIN reset since the signed `.lic` and its fingerprint match is unaffected only if the reimage didn't change `MachineGuid`/volume serial; if it did, that's correctly `MACHINE_MISMATCH` instead) — worth noting as an edge case for implementation-time test coverage.

## D1-D7 status

All seven decisions are **APPROVED**, with D2 approved **as amended** (bound-at-signing activation flow replacing the earlier unbound-self-binding draft) and D7 approved with the state table and RBAC exemption fully specified above. No open decisions remain from this round.

READY FOR IMPLEMENTATION: NO — design frozen and approved; implementation has not yet been explicitly authorized to begin in this conversation.
