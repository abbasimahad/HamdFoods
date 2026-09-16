# Phase 35 — Final Security Hardening Design

Status: **DESIGN DRAFT — NOT APPROVED, NOT IMPLEMENTED**. Threat-model-driven audit of the complete production ERP (Phases 1-34) against the twenty-five areas requested, using direct code/config inspection (this pass) plus four parallel deep-research passes over auth/sessions/CSRF, RBAC/guards/audit coverage, account-recovery/validation/uploads/error-handling, and Windows infrastructure/network exposure/secrets, plus a `pnpm audit` dependency scan. Every finding below is grounded in a specific file/line; nothing here is a theoretical or generic hardening suggestion without a concrete gap behind it.

## 1. Threat model

**Actors considered:**

- An unauthenticated party who can reach the loopback port or an authorized Tailscale tailnet device (a factory PC, a remote manager's phone) but holds no ERP credentials.
- An authenticated but low-privilege ERP user (e.g. a Sales role) attempting to act outside their granted permissions.
- A person with physical/console access to the factory PC, but not a local Windows Administrator (e.g. a staff member using the machine for other purposes).
- A local Windows Administrator (the owner/operator) — trusted for operational tasks (install/repair/recovery), but the design should still prevent an Administrator action from silently becoming a _remote_ attacker's backdoor.
- A malicious or compromised npm dependency (supply-chain).
- The vendor's own build/release pipeline (protecting license and update signing keys from ever entering the product or repository).

**Attack surfaces, ranked by the stated priorities:**

1. Business data (inventory, purchasing, production, sales, accounting) — reached only through authenticated server actions/pages.
2. Authentication and admin authority — Better Auth, RBAC guards, SUPER_ADMIN protections, account recovery.
3. Inventory/accounting integrity — server-side validation, audit trail, immutability triggers (pre-existing, out of this audit's file-reading depth but referenced).
4. Remote exposure — loopback bindings, Tailscale Serve (never Funnel), Windows Firewall posture.
5. Secrets/license/update trust roots — Ed25519 private keys (license + update, independent), DPAPI-sealed local state, ProgramData ACLs.
6. Recovery/backup capability — guarded restore, retention, off-site copy (manual).

**Out of scope for this threat model** (already load-bearing, unrelated to Phase 35, or the user's own documented deferrals): the correctness of accounting/inventory posting logic itself (covered by Phases 1-27's own test suites), 2FA, and anything requiring a network-facing public deployment model (this product is loopback + private Tailscale only by design).

## 2. Dependency audit (`corepack pnpm audit`)

11 advisories found: **2 critical, 8 high, 1 moderate**. Applying threat-model reachability analysis (not just the raw severity label) to each:

| Package                                                                                                               | Advisory                                                                                                                                                  | Reachable from the running production server?                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| --------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `next` 16.3.2 (direct dep, `package.json:76`)                                                                         | GHSA-p293-qw3h-jr36 — unauthenticated RCE **on Windows-hosted servers**; GHSA-2xp9-vwfh-vxw4 — unauthenticated RCE in the Image Optimization API via AVIF | **Yes.** `next` is the actual running server framework (`npx next --version` confirms `16.3.2` resolved, inside both vulnerable ranges `>=16.0.0 <16.3.3`). The Windows-specific advisory matches this product's _only_ deployment target exactly.                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `sharp` (`.>next>sharp`)                                                                                              | GHSA-rgj7-g3m4-5g8c — libheif vulnerabilities                                                                                                             | **Framework-level, not app-triggered today.** No `next/image` usage or `images` config exists anywhere in `src/` (confirmed by grep) — but Next.js's built-in `/_next/image` optimizer route exists by default whenever `next start`/standalone serves the app, independent of whether app code imports `next/image`. This is the same pre-auth surface as the AVIF RCE above.                                                                                                                                                                                                                                                                                            |
| `deepmerge-ts` <8.0.0, `mysql2` <3.22.0/<=3.23.0 (×2 advisories), `fast-uri` <3.1.6 (×4 advisories), `js-yaml` <4.3.2 | Various (stack exhaustion, credential downgrade, SSRF/host-confusion in URI parsing, CPU DoS)                                                             | **No.** Every path resolves through `prisma`'s own bundled CLI tooling (`@prisma/dev`, `@prisma/config`, `@prisma/streams-local`) or `eslint`'s tooling chain — build-time/admin-CLI-time dependencies never imported by the Next.js server bundle or reachable by an HTTP request. `mysql2` in particular is Prisma's optional multi-database-driver support; this project uses only PostgreSQL, so the MySQL wire-protocol code is never invoked. Exploiting any of these would require an attacker who can already run arbitrary local CLI commands with attacker-controlled arguments — a strictly larger compromise than any of these advisories individually grant. |

No dependency-audit script or CI/Dependabot/Renovate config exists in the repository (`package.json`'s `scripts` block has no `audit` entry; no `.github/dependabot.yml`). This means the CRITICAL `next` finding above would never have been surfaced automatically — it was found only because this audit ran `pnpm audit` by hand.

## 3. Findings

### CRITICAL

**C1 — Next.js 16.3.2 is inside two unauthenticated-RCE advisory ranges, one specific to this product's exact deployment (Windows-hosted).**

- **Affected**: `package.json:76` (`"next": "16.3.2"`); confirmed resolved version via `npx next --version`.
- **Attack/failure scenario**: GHSA-p293-qw3h-jr36 allows unauthenticated remote code execution against a Next.js server _running on Windows_ in versions `>=16.0.0 <16.3.3`. This product is Windows-only by design (Phase 30-32). Any actor able to reach `127.0.0.1:3100` (a local process) or an authorized Tailscale tailnet peer (Phase 31) could attempt this without any ERP credential. GHSA-2xp9-vwfh-vxw4 is a second, independent unauthenticated RCE in the built-in Image Optimization API when AVIF files are processed — reachable via the framework's default `/_next/image` route even though this app never uses `next/image` (see C1's related `sharp` note above).
- **Current protection**: network exposure is already minimized (loopback + private Tailscale Serve only, no Funnel — see "Already secure" below), which reduces but does not eliminate the actor population (any of potentially several authorized tailnet devices, or any process on the same machine, could still reach it).
- **Exact gap**: running a version inside the vulnerable range with no compensating control at the framework layer.
- **Recommended fix**: upgrade `next` to `>=16.3.3` (latest 16.x patch at implementation time). As defense-in-depth (this app never uses `next/image`), also add `images: { unoptimized: true }` to `next.config.ts` to remove the Image Optimization API route's attack surface entirely, independent of the version fix.
- **Regression risk**: LOW — patch-version bump within the same major; Next.js patch releases are not expected to change routing/behavior for an app that doesn't use the fixed subsystems. `sharp`'s transitive version will move with `next`'s own dependency bump; verify the resolved `sharp` version is `>=0.35.4` after the bump (`pnpm why sharp`).
- **Tests required**: full `pnpm verify` (build must still produce all ~140 routes cleanly), full disposable-DB E2E suite (40+ checks), and a manual production health/login/navigation smoke check after redeploy. Re-run `pnpm audit` afterward to confirm both advisories clear.

### HIGH

_(none beyond C1 — see MEDIUM for the license-enforcement inconsistency, which was considered for HIGH given it is one of the audit's explicitly-requested verification items that failed, but is placed at MEDIUM because it does not grant unauthorized access, leak data, or escalate privilege — it only weakens the license *business-model* enforcement for three item types.)_

### MEDIUM

**M1 — License-restriction bypass for three master-data mutation handlers (undocumented, apparently unintentional).**

- **Affected**: `src/server/master-data/item-action-handlers.ts:8,16,58` (imports `requirePermission` from `@/server/auth/server-guards`, the **unrestricted** guard), used by `src/app/(erp)/inventory/raw-materials/actions.ts`, `.../finished-goods/actions.ts`, `.../packaging-materials/actions.ts`. Contrast with sibling master-data files `inventory/categories/actions.ts:12`, `inventory/units/actions.ts:9`, `inventory/warehouses/actions.ts:10`, which correctly import `requirePermission` from `licensed-guards` for the same `inventory.manage` permission.
- **Attack/failure scenario**: this is not an unauthorized-access issue — RBAC (`inventory.manage`) is still fully enforced. The gap is that Phase 33's restricted-mode design ("restricted mode blocks only ordinary business mutations... every `actions.ts` file except `account/security` and `administration/license`") is violated for these three specific mutation types: an installation in `EXPIRED`/`MACHINE_MISMATCH`/`TAMPERED_STATE`/any restricted license state can still create/edit raw materials, finished goods, and packaging materials, when every other business mutation in the app is correctly blocked. This is exactly the "license/update recovery exemptions are narrowly scoped" property this audit was asked to explicitly verify — it fails for these three files, and unlike the three deliberate exemptions (`account/security`, `administration/license`, `administration/updates`, all of which carry an explanatory code comment documenting _why_ they're exempt), nothing here documents this as intentional. It has the shape of an accidental oversight (item-action-handlers.ts was likely written once, before or independent of the Phase 33 licensed-guards rollout, and never revisited).
- **Current protection**: RBAC permission check is intact; only the license-restriction layer is missing.
- **Exact gap**: `item-action-handlers.ts` imports the unrestricted guard instead of `licensed-guards`.
- **Recommended fix**: change the import in `item-action-handlers.ts` to `@/server/auth/licensed-guards`, matching every sibling master-data module. Add a regression test (mirroring the existing `licensed-guards` wrapper test suite) that specifically exercises raw-materials/finished-goods/packaging-materials save/status actions under a restricted license state and asserts they are blocked, so this class of drift can't silently recur.
- **Regression risk**: LOW — this only changes behavior for installations that are actually in a restricted license state (a minority, deliberately degraded state); for a normally-licensed installation, `licensed-guards`'s wrapper is a no-op pass-through to the same underlying `requirePermission` check, so behavior is identical.
- **Tests required**: extend `src/modules/access/domain/authorization.test.ts`-style or the dedicated `licensed-guards` test file with three new cases (one per item type) confirming a restricted license state now blocks the mutation; full disposable-DB E2E pass to confirm normal (licensed) master-data CRUD is unaffected.

**M2 — Several server actions return raw `error.message` (including database error text) directly to the browser.**

- **Affected**: `src/app/(erp)/accounting/actions.ts:131-136,152` (journal reversal/backfill), `src/app/(erp)/administration/updates/actions.ts:95`, `src/app/(erp)/production/recipes/actions.ts:79,98`, `src/app/(erp)/sales/payments/actions.ts:86`. Pattern: `catch (error) { return { ok: false, message: error instanceof Error ? error.message : "..." } }`.
- **Attack/failure scenario**: an authenticated user (already holding the relevant permission) triggers an unexpected failure path (e.g. a concurrent-transaction conflict, an unusual constraint violation) and receives the raw underlying error text in the UI. Since `PrismaClientKnownRequestError` extends `Error`, this can include internal identifiers, constraint names, or other schema-shape details not meant for end users. This requires the user to already be authenticated and permitted for that action — it is an information-disclosure issue, not an authentication or authorization bypass.
- **Current protection**: the user must already hold the permission for that specific action; the health endpoint and system-health probe already correctly swallow errors into a generic status (`src/app/api/health/route.ts`, `src/modules/system/application/get-system-health.ts:10-14`) — this pattern exists correctly elsewhere in the codebase, it's just not applied consistently to these five call sites.
- **Exact gap**: `error.message` forwarded verbatim to the client instead of a generic message plus server-side detail capture.
- **Recommended fix**: introduce one small shared helper (e.g. `toActionFailure(error, fallbackMessage)`) that logs the real error server-side (respecting whatever the eventual logging approach is — see L5) and always returns a generic, non-leaking message to the client; apply it at the five call sites above. Grep the rest of the `actions.ts` tree for the same `error.message` pattern during implementation to catch any this pass didn't enumerate exhaustively.
- **Regression risk**: LOW — purely changes the text of already-failure-path messages; does not change success-path behavior.
- **Tests required**: a unit test per affected action asserting a simulated Prisma error produces a generic message, not the raw error text.

**M3 — No security response headers anywhere in the application.**

- **Affected**: `next.config.ts` (no `headers()` function); no `middleware.ts` exists.
- **Attack/failure scenario**: no `Content-Security-Policy`, `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`, or `Strict-Transport-Security` header is set on any response. In a loopback/private-Tailscale-only deployment, the population that can reach the app at all is already constrained, but this is still a standard baseline expectation for a "final security hardening" pass, and provides defense-in-depth against browser-side attack classes (clickjacking, MIME-sniffing, unexpected third-party script/frame embedding) that don't depend on network reachability assumptions holding forever.
- **Current protection**: none at the header level; network-layer restriction (loopback/Tailscale) is the only current mitigation for this class of risk.
- **Exact gap**: absence of a `headers()` block in `next.config.ts`.
- **Recommended fix**: add a `headers()` function in `next.config.ts` applying `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`, and a `Permissions-Policy` disabling unused browser features (camera/microphone/geolocation), at minimum. A `Content-Security-Policy` should be scoped carefully (this app is server-rendered with some client components; a `default-src 'self'` baseline plus `frame-ancestors 'none'` is a defensible starting point) — **treat exact CSP directives as a decision requiring approval (D2)** rather than guessing at implementation time, since an overly strict policy could break legitimate inline styles/scripts the framework itself injects.
- **Regression risk**: MEDIUM if CSP is too strict (could break legitimate framework-injected inline scripts/styles) — mitigate by shipping CSP in `Content-Security-Policy-Report-Only` first if uncertainty remains, or by testing thoroughly against the full E2E suite (which exercises every major page) before enforcing.
- **Tests required**: E2E assertion that key routes still render/function with headers applied; a dedicated header-presence check (can be a lightweight Playwright or unit-level fetch assertion).

**M4 — No dependency-vulnerability tooling wired into the repository.**

- **Affected**: `package.json` (`scripts` block has no audit entry); no Dependabot/Renovate config.
- **Attack/failure scenario**: exactly the scenario that produced C1 — a critical, directly-exploitable vulnerability in a pinned direct dependency went undetected for as long as nobody manually ran `pnpm audit`. This is a process gap, not a code defect.
- **Recommended fix**: add a `"security:audit": "pnpm audit"` (or `--audit-level=high`) script for operator/CI use. `pnpm audit` requires network access to the npm registry advisory database, so it cannot be part of the fully-offline `pnpm verify` chain — document it as a separate, periodic (e.g. pre-release) manual/CI step rather than folding it into `verify`.
- **Regression risk**: NONE (additive tooling only).
- **Tests required**: none beyond confirming the script runs.

### LOW

**L1 — Vendor update-signing tool builds a PowerShell `-Command` string via unescaped interpolation.**

- **Affected**: `scripts/updates/sign-update-package.ts:132-151` (`Compress-Archive`/`Move-Item` invoked via `execFileSync(powershell, ["-Command", \`...${stagingDir}...${zipTemp}...\`])`).
- **Attack/failure scenario**: this is vendor-only, operator-invoked release tooling (never shipped or reachable by the running application, confirmed by repo-wide reference search) — the interpolated values come from the operator's own `--payload-dir`/`--out` CLI flags, not from any web/attacker input. Practically not exploitable today, but the pattern (unescaped single-quoted string interpolation into a `-Command` block) is the same shape as a real injection primitive, and this is precisely the vendor's own package-signing tool — a trust-root component.
- **Recommended fix**: switch to array-form arguments (`Compress-Archive -Path ... -DestinationPath ...` via a PowerShell script invoked with `-File` and positional/named parameters, matching the safe pattern already used everywhere else in this codebase, e.g. `ConvertTo-HamdFoodsWindowsCommandLineArgument`) so the tool remains safe even if future automation ever feeds it less-trusted paths.
- **Regression risk**: LOW — vendor tooling only, not part of any customer-facing or automated path.
- **Tests required**: manual re-run of `scripts/updates/sign-update-package.ts` against a sample payload to confirm the resulting `.hfupdate` is still byte-identical in structure and still verifies correctly.

**L2 — Uploaded license file content is briefly written to disk before its signature is verified.**

- **Affected**: `src/server/licensing/license-file-store.ts:66-86` (`importLicenseFileContent`/`importLicenseFile`).
- **Attack/failure scenario**: an authenticated `license.manage` holder uploads a `.lic` file; the content is shape-checked (string/object fields) and written to a **fixed, non-attacker-influenced path** (`config/license.lic`) before Ed25519 signature verification happens on next read. The write path itself is safe (not attacker-controlled), and the claims inside are never _trusted_ until verified — but an unverified file transiently exists on disk.
- **Recommended fix**: verify the signature in-memory before the first disk write, only persisting a file that has already passed verification (mirrors the Phase 34 update-package pattern, where `verifyUpdatePackageFile` runs before anything is staged as trusted).
- **Regression risk**: LOW — pure reordering of existing steps.
- **Tests required**: existing license-import unit/integration tests should still pass unchanged; add one asserting a corrupted/unsigned upload never touches `config/license.lic`.

**L3 — No general-purpose application-level logger; error/exception observability outside `recordAuditEvent` and Windows process-level stdout/stderr capture is minimal.**

- **Affected**: whole `src/` tree (zero `console.log/error/warn` calls found outside CLI scripts).
- **Attack/failure scenario**: not itself a vulnerability — in fact it means there is currently nothing to accidentally leak secrets through (confirmed no raw secret/error-object logging anywhere). But it also means an unexpected runtime exception that doesn't go through `recordAuditEvent` has no structured record beyond whatever the Scheduled Task's own log redirection captures, which limits incident-response/forensics capability.
- **Recommended fix**: out of scope for a "hardening" pass unless paired with a redaction-aware logger (adding raw logging without redaction would be a net-negative). If pursued, it should reuse the same secret-pattern redaction already proven in `ConvertTo-HamdFoodsSafeLogText` (`installer/scripts/Common-HamdFoodsERP.ps1:19-34`), ported to TypeScript.
- **Regression risk**: N/A (recommend deferring; see Out of scope).
- **Tests required**: N/A if deferred.

**L4 — Backup redundancy is single-machine and manual; no automated off-site copy.**

- **Affected**: `docs/operations/backup-and-recovery.md:93` (already documents this as a known boundary, not a hidden gap): _"Local success is not redundancy... No Google Drive, Dropbox, S3, OneDrive, or other cloud integration exists."_
- **Attack/failure scenario**: total loss of the physical machine (theft, fire, disk failure) destroys the production database and every local backup simultaneously, since `BACKUP_DIRECTORY` defaults to the same machine.
- **Recommended fix**: this is an **operational** control (an operator manually copying `.dump`/`.manifest.json` pairs off-site), not a code change — appropriately left as a documented operator responsibility rather than an in-app feature, consistent with Phase 28's original scope decision. Recommend re-confirming with the operator that an off-site copy procedure is actually being followed, not adding code.
- **Regression risk**: N/A.
- **Tests required**: N/A (operational, not code).

**L5 — Several application-layer modules (`manage-users.ts`, `manage-account-security.ts`, `manage-role-permissions.ts`) perform no input validation themselves, relying entirely on their `actions.ts` caller having already validated.**

- **Affected**: as named above.
- **Attack/failure scenario**: not currently exploitable — every existing caller does validate before calling. This is a defense-in-depth/future-proofing note: a new caller added later without validating first would have no safety net at the application layer.
- **Recommended fix**: optional; add a defensive `z.string().uuid()`/shape check at the top of these specific functions matching the pattern already used in `manage-batches.ts`.
- **Regression risk**: LOW.
- **Tests required**: if implemented, one unit test per function confirming it rejects malformed input even when called directly.

### INFORMATIONAL

- Better Auth's default rate limiter (100 requests/10s per key, in-memory) is active in production by default (`isProduction` evaluates true, and `auth-options.ts`/`auth.ts` never override `rateLimit`) — this is real and already present, just untuned/generic rather than auth-attempt-specific. Documented in `docs/engineering/security.md` as a known, deliberately deferred gap (dedicated login lockout, 2FA); this audit found no evidence contradicting that the gap is as narrow as documented.
- Foreign-key/ownership validation for IDs passed from the client (supplier/item/account IDs) relies on PostgreSQL foreign-key constraints at write time rather than an explicit pre-existence check — an acceptable, if implicit, pattern; failures surface as a generic caught error (compounding with M2 above where that generic error is sometimes forwarded raw to the client).
- Session/cookie settings are unmodified Better Auth defaults (`httpOnly: true`, `sameSite: lax`, `secure` derived from the configured origin's protocol) — correctly reasoned for a loopback-HTTP/Tailscale-HTTPS deployment model, not a gap.

## 4. Already secure (explicitly verified, no finding)

- **Production auth bypass cannot activate**: `src/server/env.ts` fails closed (throws at process start) if `AUTH_BYPASS_ENABLED=true` while either `APP_ENV` or `NODE_ENV` is `"production"` — both variables checked, single source of truth (`serverEnv`).
- **RBAC enforced server-side**: every protected page/action re-checks permissions server-side; no client-side-only gate found.
- **Mutation guards cannot be bypassed directly** for RBAC itself (only the _license-restriction layer_ has the M1 gap above — the underlying `requirePermission` check is intact everywhere, including the M1 files).
- **License/update recovery exemptions are narrowly scoped** for the three _deliberate_ exemptions (`account/security`, `administration/license`, `administration/updates`) — each is documented in-code with an explicit rationale comment. (M1 is the one _undocumented_ exception found.)
- **No secrets committed / no private signing keys committed**: only placeholder values in tracked `.env.example`/`.env.production.example`; `.licensing/` (both license and update private keys) is gitignored; no `-----BEGIN...PRIVATE KEY-----` material in any tracked file.
- **PostgreSQL remains loopback-only**: enforced both at the application env-validation layer (`isLoopbackHost`) and at installer provisioning time; no firewall rule for 5432 is ever created.
- **App remains loopback + approved Tailscale Serve only; no Funnel**: Funnel is explicitly checked-against before and after every Serve configuration change and refused if detected; no code path ever invokes `tailscale funnel`; Serve's proxy target is a hardcoded `127.0.0.1:3100` constant, cross-checked against actual listener state.
- **No unsafe arbitrary filesystem paths**: `Assert-HamdFoodsManagedPath` validates every installer/orchestrator path against a fixed expected root; the Update task's action string is fixed at install time and never receives attacker/web-supplied paths — it reads a controlled `packageId` from an ACL-protected state file instead (independently confirmed via this session's own live Windows update drills).
- **No command injection in PowerShell/Node operational scripts**: every `Start-Process`/`spawnSync`/`execFileSync` call in the installed product uses array-form arguments or the project's own command-line-escaping helper; the one exception found (L1) is vendor-only tooling never reachable by the running application.
- **Update package extraction remains traversal-safe**: independently verified this session via real live-Windows drills (path-traversal entries rejected, undeclared entries rejected, post-extraction hash re-verification catches tampering) — including a real defect found and fixed during that work (failed extraction now correctly deletes the partial/bad release directory).
- **Backup restore remains guarded**: target-name markers, system/production/source-name rejection, and manifest/checksum verification before any destructive action; restore is never called from any automated path (update orchestrator, backup task, or web action) — confirmed by a repo-wide caller search.
- **Account recovery cannot become a remote backdoor**: no HTTP route or network listener exists for it anywhere; it independently re-verifies High/System integrity Administrator elevation via `whoami /groups`; the password is transmitted only over redirected stdin, never argv/env.
- **Audit events cover privileged security operations**: every dangerous admin operation identified (role/permission changes, user deactivation/role replacement, admin password reset, license import/reset, update upload/install, local account recovery) writes a `recordAuditEvent` call.
- **Logs do not expose credentials/secrets**: PowerShell-side redaction (`ConvertTo-HamdFoodsSafeLogText`) scrubs connection-string credentials, key/value secret patterns, and long hex strings; the Node/TS side has no raw secret-adjacent logging to redact in the first place (zero `console.*` calls outside CLI tooling, none of which print environment/secret values).
- **Production errors fail closed where required**: the health endpoint and system-health probe never leak internal detail regardless of the underlying failure (M2's raw-`error.message` cases are a narrower, separate issue in specific business-mutation actions, not the health/monitoring surface).

## 5. Decisions requiring approval

- **D1.** Confirm M1's fix (point `item-action-handlers.ts` at `licensed-guards`) is correct and not an intentional design choice this audit misunderstood. (Recommended: yes, fix it — no code comment or design doc documents this as intentional, and it's inconsistent with every sibling master-data module.)
- **D2.** Choose the Content-Security-Policy approach for M3: (a) ship a strict `default-src 'self'; frame-ancestors 'none'` policy directly, verified against the full E2E suite before enforcing; or (b) ship `Content-Security-Policy-Report-Only` first for an operator-observed burn-in period, then tighten to enforced. (Recommended: (a) — this is an internal admin tool with a small, well-understood page set already fully covered by the existing E2E suite, so report-only adds delay without much additional safety margin here.)
- **D3.** Confirm the `next` upgrade target: exactly `16.3.3`, or the latest `16.x` patch available at implementation time. (Recommended: latest `16.x` patch, to also pick up any advisories disclosed between now and implementation — re-run `pnpm audit` at implementation time regardless of which is chosen.)
- **D4.** Confirm scope boundary: rate limiting beyond Better Auth's existing default (e.g. a dedicated login-attempt lockout) is explicitly **out of scope** for Phase 35 per the existing documented deferral, unless the operator wants it pulled forward now. (Recommended: leave deferred — no new evidence in this audit changes the existing risk acceptance for a loopback/private-Tailscale-only deployment.)
- **D5.** Confirm L3 (general app-level structured logging) and L4 (automated off-site backup) are explicitly **out of scope** for Phase 35 (operational/observability investments, not security defects). (Recommended: out of scope, noted for a future phase or operator procedure respectively.)

## 6. Test plan (for the implementation phase)

- **C1**: full `pnpm verify` (unchanged pass expected), full disposable-DB E2E suite, `pnpm audit` re-run confirming both `next` advisories and the `sharp` advisory clear, manual production smoke test after redeploy (login, dashboard, a representative mutation, health check).
- **M1**: new unit tests in the `licensed-guards` suite for raw-materials/finished-goods/packaging-materials under a restricted license state (expect blocked); full disposable-DB E2E pass confirming normal master-data CRUD unaffected when licensed.
- **M2**: one unit test per fixed call site asserting a simulated thrown error produces a generic client-facing message, not raw `error.message`.
- **M3**: E2E pass confirming all major routes still render/function correctly with the new headers; explicit header-presence assertions on at least the login page and one authenticated page.
- **M4**: confirm the new `security:audit`/`pnpm audit` script runs and reports the same baseline established in this design.
- **L1**: manual re-sign of a sample update package after switching to array-form PowerShell invocation; confirm the resulting `.hfupdate` still verifies correctly end-to-end (can reuse the drill tooling built during Phase 34 verification).
- **L2**: existing license-import tests unchanged; add one confirming an unsigned/corrupted upload never reaches `config/license.lic`.
- **Regression baseline for the whole phase**: `pnpm verify`, disposable-DB integration suite, disposable-DB Chromium E2E suite, and `git diff --check` must all pass exactly as they did at Phase 34's closure before this phase can be marked complete.

## 7. Risks

- Upgrading Next.js (C1) is low-risk in isolation, but this project has 34 phases of accumulated routes/behavior riding on the current version — the full E2E suite (40+ checks across every major module) is the load-bearing safety net here and must not be skipped or sampled.
- A misjudged CSP (M3/D2) could silently break a page that isn't covered by the E2E suite's specific assertions (the suite checks functional behavior, not necessarily every inline style/script Next.js itself injects) — recommend a manual visual pass across the major modules in addition to the automated suite.
- M1's fix changes real behavior for any installation _currently_ running in a restricted license state (if any exist in the field) — those installations will newly find raw-materials/finished-goods/packaging-materials edits blocked, which is the _intended_ correction, but should be called out to the operator as a user-visible behavior change, not silently shipped as a "bug fix."

## Out of scope

- Two-factor authentication, dedicated login-attempt rate limiting/lockout, secret rotation tooling, and a general-purpose redacting application logger — all pre-existing, explicitly documented deferrals (`docs/engineering/security.md:38`) that this audit found no new evidence to pull forward.
- Automated off-site/cloud backup replication — an operational procedure, not a code change, consistent with Phase 28's original scope boundary.
- Re-verifying inventory/accounting posting correctness itself — already covered by Phases 1-27's own extensive test suites; this audit's scope was the security surface around that logic, not the logic's business correctness.
- Any change to the Phase 34 update mechanism's core design (already independently drilled and verified this session) beyond the two narrow, already-cited items (L1's signing-tool invocation style, L2's verify-before-write ordering for license import specifically, which is licensing not update code).

## READY FOR IMPLEMENTATION: NO

Design only, per instruction. Do not implement any of the above until D1-D5 are confirmed or amended. Do not begin Phase 36.
