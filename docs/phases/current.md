# Current phase

## Administration Settings

**Status:** COMPLETE

### Implemented boundary

- `/administration/settings` owns exactly one genuine, previously-unowned surface: the Company/Factory Profile (legal name, address, city, phone, email, tax registration number), per `docs/specs/2026-09-14-administration-settings-design.md` (D1-D5 approved as recommended). Everything else considered during design inspection already had an owner (accounting mappings/periods, users, roles, audit, master data) or was explicitly rejected as out of scope (document numbering, session/auth policy, backup schedule, logo upload, PWA manifest).
- Persisted as a `CompanyProfile` singleton row (`id: "default"`), the same convention already used by `AccountingSettings`. Gated end-to-end by a new `settings.manage` permission (default `SUPER_ADMIN`/`ADMIN` only); every save writes one audited `AuditEvent` (`entityType: COMPANY_PROFILE`) with before/after snapshots.
- Printed documents (purchase orders, sales orders/invoices/dispatches/returns/payments, expense vouchers, treasury transfers) and the authenticated shell header now render the saved profile live at request time, replacing the previously hardcoded `"Hamd Foods ERP"` string in 11+ files. Presentation only: does not read or write inventory, valuation, accounting mappings, accounting periods, RBAC, posted documents, production costing, or tax authority.
- The migration seeds the singleton row with `legalName: "Hamd Foods ERP"`, so production deployment produced zero visible change until an administrator explicitly edits it.

### Current evidence

- Domain unit tests: 7/7. Application-layer unit tests: 4/4. `pnpm verify`: PASS — Prettier, ESLint, Prisma validate/generate, 351 unit tests passed with 2 skips, TypeScript, and the 92-page Next production build.
- Disposable PostgreSQL integration (3 new tests): seeded default row is a true singleton; save records exactly one audit event with before/after snapshots and never creates a second row; saving the profile leaves inventory movement/valuation, accounting journal, accounting mapping, and role-permission counts unchanged. Full disposable-DB run: 43 passed / 1 intentional infrastructure-gated skip.
- Disposable-DB Chromium E2E (2 new tests): an administrator edits and persists the company profile; a view-only identity is denied the route. Full E2E run: 34/34, one worker, zero retries. (A locale-dependent `Date#toLocaleString()` hydration-mismatch risk was found and fixed during this work — see Documentation drift / fixes below.)
- Production: verified backup taken, migration `20260914185802_administration_settings_company_profile` applied (42/42 migrations current), `HamdFoodsERP` task restarted, health `200 {"status":"ok"}`, both new routes (`/administration/settings`, `/purchasing/purchase-invoices`) confirmed loading without a server error, no error/fatal/exception in recent logs, loopback-only listeners confirmed for both the app and PostgreSQL.

### Fixes made alongside this work

- **Hydration-mismatch risk removed:** `Date#toLocaleString()` reads the runtime's default locale, which can differ between the Node SSR process and the browser. This was found (via a reproducible E2E failure) in the new Company Profile form and, on inspection, also already present in the Purchase Invoice detail page (`postedAt`/`reversedAt`). Both were fixed with a new deterministic `formatDateTimeUtc()` helper (`src/components/ui/format-datetime.ts`). Twenty-two other pre-existing files use the same `.toLocaleString()` pattern; none have ever shown this failure across this project's full certified test history, so they were deliberately left untouched rather than speculatively rewritten.
- Workflow inventory reconciled to 58 `COMPLETE`, 0 `PARTIAL`, 0 `MISSING` — every sidebar entry is now complete.

## Purchase Invoices

**Status:** COMPLETE

### Implemented boundary

- `PurchaseInvoice` is a PO-to-GRN-to-invoice matching and true-up document. `PurchaseInvoiceLine` anchors to a `PurchaseOrderLine` (supporting a pre-GRN draft with zero matches); `PurchaseInvoiceLineMatch` joins a line to one or more QC-completed `GoodsReceiptLine`s, so one invoice line can span multiple GRN lines and one GRN line can be claimed by multiple invoices, bounded by accepted-and-unbilled quantity.
- POST requires every line's matches to sum exactly to its invoiced quantity (zero tolerance) and re-validates, transactionally under Serializable isolation, that no GRN line's combined POSTED matches exceed what QC accepted. An exact-price/tax match posts no journal and no payable-ledger entry; only a nonzero price or tax variance posts a single true-up journal (`PURCHASE_PRICE_VARIANCE` and/or `INPUT_TAX`/`PURCHASE_TAX_EXPENSE`, against `ACCOUNTS_PAYABLE`) and a dedicated `PURCHASE_INVOICE_VARIANCE` supplier-payable ledger entry. GRNI, existing AP recognition, and FINAL inventory valuation from GRN QC are never re-posted, adjusted, or revalued.
- Matches, frozen unit cost/tax/variance snapshots, and header content are immutable once POSTED (database trigger), mirroring the existing GRN/purchase-return guard pattern. `(supplierId, supplierInvoiceNumber)` is a database-unique pair, so a duplicate supplier invoice cannot be entered twice, draft or posted.
- REVERSE is a single-document status flip to `REVERSED`: an exact-match invoice reverses with no fabricated accounting; a variance invoice posts one compensating journal and ledger entry from the frozen header totals, throwing (not blocking) if no OPEN accounting period covers the reversal date. POST and REVERSE are both idempotent under a guarded status-transition claim inside their Serializable transaction, so a duplicate submission or a losing concurrent race creates nothing.
- `purchasing.manage` gates the full lifecycle, matching every other purchasing workflow; no new permission was added. Due date is informational only and is not read by `payableAging()` or any report.

### Current evidence

- Domain unit tests: 16/16. Application-layer unit tests: 15/15. `pnpm verify`: PASS — Prettier, ESLint, Prisma validate/generate, 340 unit tests passed with 2 skips, TypeScript, and the 91-page Next production build.
- Disposable PostgreSQL integration (`purchase-invoice.integration.test.ts`, 13 tests): exact match with no accounting; positive and negative price variance with balanced true-up journals and exact reversal; tax variance under `RECOVERABLE` and the `NOT_CONFIGURED` block; incomplete-match POST rejection; partial invoicing and multiple invoices against one GRN line; one invoice matched across two GRN lines; duplicate supplier-invoice-number rejection; pre-GRN draft blocked from posting until matched; concurrent over-invoicing resolved to exactly one winner; closed-period POST block vs. closed-period REVERSE throw; immutability and audit-event assertions. Full disposable-DB run: 40 passed / 1 intentional infrastructure-gated skip, no regression to existing golden-workflow or reconciliation coverage.
- Disposable-DB Chromium E2E (`purchase-invoices.spec.ts`): create/edit/cancel draft through the active workbench, and permission-denied redirect for a view-only identity. Full E2E run: 32/32, one worker, zero retries.
- `docs/testing/workflow-inventory.md` is reconciled to 58 `COMPLETE`, 0 `PARTIAL`, 1 `MISSING` (Administration Settings only). Design authority: `docs/specs/2026-09-14-purchase-invoices-design.md` (D1–D8 frozen, D6 amended to a dedicated `PURCHASE_INVOICE_VARIANCE` ledger type).

## Partial Workflows - Reprocess and Waste & Damage closure

**Status:** COMPLETE

### Implemented boundary

- Reprocess now controls eligible finished-good custody through DRAFT, reservation, physical WIP consumption, one linked `REPROCESS` production batch, a distinct child lot, conservative policy-bounded expiry, yield reconciliation, finalized costing, and independent quality release/rejection.
- Waste & Damage now provides lot-specific multi-line DRAFT, POSTED, CANCELLED, and safe REVERSED dispositions for `MOVE_TO_SCRAP`, `MOVE_TO_REPROCESS`, and `WRITE_OFF` without creating Reprocess production/output records prematurely.
- Inventory movements, valuation entries, accounting journals, genealogy, actors, reasons, dates, and reversals are immutable. WRITE_OFF reversal restores the original write-off value with compensating entries and rejects downstream-used custody.
- Searchable/filterable responsive workbenches expose permission-safe lifecycle actions. Reprocess QC requires `quality.manage` and forbids initiator/completer self-review even for administrators.
- Purchase Invoices and Administration Settings remain the only two `MISSING` workflows and were not changed. Phase 33 is not started.

### Current evidence

- Focused Task H tests: 15/15 passed; focused Task I tests: 17/17 passed.
- Disposable PostgreSQL integration: 27 passed / 1 intentional infrastructure-gated skip; all 40 migrations applied with no concurrent-query warning.
- Chromium E2E: 30/30 passed using one worker and zero retries, including edit/reserve/start, linked batch, independent QC, Waste post/reversal, filters, and 375/768/1280 containment.
- `pnpm verify`: PASS - Prettier, ESLint, Prisma validate/generate, 309 unit tests passed with 2 skips, TypeScript, and the 89-page Next production build.
- Final traced integration: PASS - 27 passed / 1 intentional infrastructure-gated skip; no PostgreSQL concurrent-query or deprecation warning.
- Final disposable E2E: PASS - 30/30, one worker, zero retries; no destination-stream, Node/server, hydration, or browser application errors.
- Production preflight, loopback PostgreSQL connectivity, task restart, `127.0.0.1:3100` listener, and health check passed. Production migration/deployment and Git synchronization use the established backup-first closure procedure.

## Phase 32 - Native Windows Installer and Factory-PC Setup

**Status:** COMPLETE

### Implemented Phase 32 boundary

- Inno Setup source installs the product under `C:\Program Files\HamdFoodsERP` and keeps protected config, logs, backups, and state under `C:\ProgramData\HamdFoodsERP`. The installed task uses bundled Node 24.11.1 and never depends on the repository, PATH, pnpm, Corepack, developer tooling, or Docker.
- Release commands provide non-secret preflight, deterministic payload preparation, payload verification, normal compilation, and isolated drill compilation. Node is downloaded only at build time from its official versioned archive and checked against the pinned official SHA-256; third-party archives, generated EXEs, signing material, secrets, backups, and logs are ignored.
- Installed setup accepts only canonical production resources or the complete isolated drill resource set. It detects only native PostgreSQL 16, verifies loopback listeners, refuses conflicts, creates a strong random non-superuser role/password and Better Auth secret, applies `prisma migrate deploy`, runs the idempotent seed, securely prompts for the first SUPER_ADMIN, and removes temporary credentials.
- Setup restricts ProgramData/config ACLs to `SYSTEM` and Administrators, reconciles a boot/restart `SYSTEM` application task, optionally installs a non-overlapping daily 02:00 backup task, and verifies fresh-install health plus one backup. Repair preserves secrets and backs up before migrations. Uninstall removes application assets/tasks but preserves database, role, ProgramData, logs, config, backups, and business data.
- No firewall rule, PostgreSQL exposure, Tailscale installation, Funnel configuration, or Serve mutation is part of the installer. The Start Menu and optional desktop shortcuts open the loopback ERP URL only.

### Phase 32 current evidence

- Focused red/green tests cover paths, identifiers, ports, installed config selection, cryptographic secrets/redaction, PostgreSQL classification, loopback enforcement, ACL/task construction, repair/fresh/uninstall plans, backup scheduling, payload exclusions, and Docker/firewall/Tailscale boundaries.
- The prepared payload runs the exact bundled Node version, loads its packaged Prisma configuration and migration CLI, contains no application `.env`, source tests, backups, logs, or signing material, and parses all installed PowerShell files successfully.
- Trusted compiler discovery supports validated standalone Inno Setup 7 installations under machine-wide Program Files or per-user `%LOCALAPPDATA%\Programs` and rejects arbitrary IDE/`node_modules` copies. The official per-user 7.1.0 compiler produced the ignored, development-unsigned installer successfully.
- The retained PostgreSQL 17 data-only cluster was investigated non-destructively, backed up under its dedicated legacy root, and classified as an inactive unmanaged artifact that setup ignores without starting or modifying it. PostgreSQL 16 remains the selected running toolchain.
- The September 5 fifth live installer drill executed successfully on port 3200 from a clean elevated context:
  - **LIVE VERIFIED**: Fresh installation, PostgreSQL 16 provisioning, loopback port 3200 listener, exact-Origin Better Auth authentication (`http://127.0.0.1:3200`), SUPER_ADMIN authorization (`/administration/users`), task-triggered backup creation and dump checksum verification (3 retained backup dumps), exact process-tree runtime restart, same-version repair/reinstall with seed rerun, post-repair authentication, and safe uninstall.
  - **LIVE VERIFIED**: Safe uninstall removed application files (`C:\Program Files\HamdFoodsERP-InstallDrill`) and Scheduled Tasks while preserving persistent customer data (`C:\ProgramData\HamdFoodsERP-InstallDrill`, database `hamd_foods_erp_installer_drill`, database role `hamd_erp_installer_drill`, state, and backups) per documented data preservation policy. PostgreSQL 17 remained untouched throughout.
- **VERIFIED**: Prettier, ESLint, TypeScript, Vitest (35 test files / 207 tests), Prisma validate/generate, and 76-route Next standalone production build passed cleanly (`pnpm verify`). Production ERP (port 3100) health and root layout hydration handling are fully verified and operational. Phase 33 is READY and not started.

### Auth recovery and final Phase 1–32 closeout

- Authenticated account security now covers display name, normalized unique login email with current-password confirmation, and current/new/confirmed password change. Credential changes revoke sessions and preserve relational RBAC. Authorized user administration adds target password reset with explicit SUPER_ADMIN protection.
- The unauthenticated forgot-password page provides local-only guidance and no mutation. The installer packages a compiled recovery program, bundled Node execution, hidden confirmed password input over standard input, independent high-integrity Administrator enforcement, safe active-admin discovery, production/drill root separation, UAC Start Menu entry, session revocation, and non-secret auditing. No remote recovery endpoint or master password was added.
- The live database is classified **LEGACY NAME BUT CURRENT CANONICAL PRODUCTION DATABASE**; the existing name is not changed. A verified pre-change custom-format backup and safe zero-valued business baseline were recorded before auth implementation. Production authentication records were not used for destructive testing.
- The prior unexplained task exit is accepted as a non-reproducible historical event. Task Scheduler Operational logging is enabled for future evidence, while the already recorded same-PID T+0 through T+300 stability result remains authoritative unless the runtime restarts.
- The September 8 closeout gate passed Prettier, ESLint, Prisma validate/generate, strict TypeScript, 39 unit-test files / 225 tests (2 expected skips), and the 78-page Next standalone build. Guarded integration passed 3 files / 13 tests (1 infrastructure-gated skip); isolated Chromium E2E passed 14 checks across desktop and mobile profiles. Installer verification staged 10,050 minimized payload files, executed the packaged recovery wrapper against the disposable database, and compiled the development-unsigned Inno installer without launching it.
- Final read-only production regression kept the original PID `19348`, healthy loopback ERP/PostgreSQL listeners, PostgreSQL 16.14/SCRAM, private Tailscale Serve, and disabled Funnel. The post-change business counts exactly matched the pre-change baseline and every journal/inventory/AR/AP/valuation/WIP/production/invoice-payment check passed. The final custom-format production backup completed and passed checksum plus `pg_restore --list` verification.

## Phase 31 - Tailscale Private Remote Access

**Status:** SERVER IMPLEMENTATION COMPLETE - REMOTE DEVICE UAT DEFERRED BY OPERATOR TO FINAL UAT

### Implemented Phase 31 boundary

- The existing Next.js standalone runtime remains bound only to `127.0.0.1:3100`, and PostgreSQL remains loopback-only on port 5432. Tailscale is an optional ingress layer and is not a dependency of local startup, health, or backup/recovery.
- Five production commands provide remote preflight, persistent private Serve configuration, non-secret status, normal-TLS remote health, and selective ERP root disable. They discover the Windows CLI without bundling or downloading it and never invoke Funnel, reset Serve/node state, alter exit-node/routes/SSH settings, start another Next server, or modify the `HamdFoodsERP` task.
- Remote preflight fails closed unless local health/listeners, Tailscale service/connection/DNS/IPv4, Windows unattended mode, exact Better Auth origins, and Funnel safety all pass. Configure proxies HTTPS 443 only to `http://127.0.0.1:3100`; disable removes only that root handler and refuses conflicting unrelated configuration.
- Better Auth remains the application authentication authority. Production origins accept only exact loopback HTTP or exact HTTPS `*.ts.net` origins; wildcard, malformed, arbitrary public HTTP/HTTPS, credential/path/query/fragment, and non-443 remote origins are rejected. Tailscale identity headers never bypass ERP login or RBAC.
- The same-origin PWA requires no remote-specific application. Tailnet Grants, user/device removal, lost-phone response, private/public distinction, troubleshooting, persistence, local fallback, and the mandatory second-device acceptance procedure are documented in `docs/operations/tailscale-private-access.md`.

### Phase 31 current evidence

- On 2026-09-03 the official Tailscale client/service is installed, connected, and configured for unattended operation. The canonical private HTTPS Serve handler proxies only to `http://127.0.0.1:3100`; local and remote health pass and Funnel is disabled.
- Focused red/green tests cover status JSON parsing, connected/disconnected state, DNS and CGNAT IPv4 extraction, exact Serve target, Funnel detection, background/selective command construction through a mocked process boundary, listener isolation, exact remote URL construction, unattended preference parsing, origin rejection, and non-secret status output.
- The final software-controlled verification passed the focused Phase 31 suite (2 files / 31 tests), `corepack pnpm verify` (32 files / 166 tests plus Prisma, TypeScript, and the 76-route production build), integration (2 files / 7 tests), E2E (10 Chromium checks), native production preflight, production health, and `git diff --check`. The elevated maintenance window confirmed port 3100 clear during the build, then restarted the canonical task with its sole listener on `127.0.0.1:3100`.
- The authorized and unauthorized second-device tests and mobile PWA acceptance were explicitly deferred by the operator to final project UAT. They are not reported as failed or fabricated.

### Deferred final-UAT gate

- From a real authorized phone/laptop outside factory Wi-Fi, verify HTTPS, Better Auth login/dashboard/navigation/logout/login, and PWA assets. Verify an unauthorized device is denied and the service is not reachable publicly without Tailscale.

## Phase 30 - Native Windows Production Hosting

**Status:** COMPLETE

### Implemented Phase 30 boundary

- Docker deployment files and commands have been removed. The supported product path is native Windows: loopback-only native PostgreSQL, Node 24/Next standalone, Windows Task Scheduler, and browser/PWA clients.
- Production environment validation now requires the real application inputs and accepts only local PostgreSQL hosts (`127.0.0.1`, `localhost`, or `::1`). It rejects the former Compose `database` hostname, LAN/public database hosts, and unsafe non-loopback HTTP Better Auth origins; HTTPS remains available for the later private-origin phase.
- `production:build` generates Prisma, builds Next standalone, and copies the public and static assets into that runtime. Explicit native commands perform preflight, migrations, seed, bootstrap, background-task operations, health, and existing Phase 28 backup operations.
- `HamdFoodsERP` is a boot-start Windows Scheduled Task that runs the standalone Node server as `SYSTEM`, retains logs under `C:\ProgramData\HamdFoodsERP\logs`, and references the ACL-protected `.env.production` without embedding secrets in its task command.
- The runbook specifies native PostgreSQL loopback configuration, dedicated non-superuser database role, the safe upgrade workflow, retained backup/recovery boundary, and a separately named native drill database. Tailscale, firewall changes, remote access, and Phase 32 installation remain out of scope.

### Phase 30 verification evidence

- The native drill environment uses `127.0.0.1:3100` consistently for the standalone bind and Better Auth origin. Production validation now rejects a loopback HTTP Better Auth host or port that differs from `HOSTNAME`/`PORT`, preventing recurrence of the sign-in connection reset without weakening authentication errors.
- Operator-observed live evidence on 2026-09-03 records the standalone Windows runtime listening on `127.0.0.1:3100`, production health passing, Factory Owner/SUPER_ADMIN authentication reaching `/dashboard`, native loopback PostgreSQL connectivity, and no Docker runtime dependency. The elevated closeout independently confirmed that `.env.production` remains ignored, inheritance-protected, and readable only by `SYSTEM` and Administrators.
- The elevated maintenance window stopped the task and the positively identified temporary diagnostic process tree, then confirmed the task was not running, port 3100 had no listener, and no canonical or diagnostic HamdFoods process remained before building. The temporary launcher file is absent and no diagnostic process remains authoritative.
- `corepack pnpm test:integration` reset only `factory_erp_test`, applied all 39 migrations, and passed 2 files / 7 tests. `corepack pnpm test:e2e` reset that isolated database and passed all 10 Chromium checks, including Better Auth login, protected navigation, invalid credentials, and logout.
- The native Phase 30 drill database `hamd_foods_erp_prod_drill` passed backup creation, listing, and SHA-256 verification through the Phase 28 implementation. `corepack pnpm backup:drill` restored only `factory_erp_restore_test` and passed checksum/unsafe-target rejection plus migration, source-fact, accounting, inventory, WIP, and audit integrity checks.
- From the elevated, port-clear shell, `corepack pnpm production:preflight`, `corepack pnpm verify`, `corepack pnpm test:integration`, `corepack pnpm test:e2e`, `corepack pnpm production:build`, and `git diff --check` all passed. The full verify included 31 Vitest files / 146 tests, Prisma validation/client generation, TypeScript, and the 76-route Next production build.
- The canonical `HamdFoodsERP` task was reinstalled with battery-safe settings and restarted while the host was on battery. It runs as `SYSTEM`; the listener ancestry is Task Scheduler service to `scripts/windows/run-production.ps1` to `scripts/production.ts start` to `.next/standalone/server.js`. The task is `Running`, `127.0.0.1:3100` is listening, production health passes, and no diagnostic launcher process exists.

### Completed Phase 29 baseline

**Phase 29 status:** COMPLETE

### Implemented Phase 29 boundary

- A Next.js App Router manifest provides Hamd Foods ERP install identity, `/login` launch behavior, standalone display, theme metadata, and optimized 192px, 512px, Apple touch, and maskable icons.
- The same-origin service worker caches only icons, the non-sensitive offline fallback, and immutable Next static assets. Authenticated navigation stays network-only, non-GET requests are untouched, and no ERP HTML/data, permission state, mutation response, ledger, or financial truth is persisted for offline use.
- A root connection lifecycle announces offline state, prevents form submission before dispatch, states that nothing was sent, never queues/replays mutations, and offers an explicit retry. Waiting worker updates require an explicit `Update now` action followed by one guarded controller-change reload.
- The existing shell preserves its desktop rail while tightening phone header controls, active nested navigation, focus handling, safe-area padding, touch targets, representative form labels/actions, and scroll-contained exact-value tables. Finished-goods carton/loose display remains derived from canonical pieces.
- Focused Playwright coverage now exercises manifest/icons, service-worker control/static caching, offline fallback, offline submission rejection, mobile login and nested navigation, inventory table scrolling/carton display, customer payment, and manual journal layouts.

### Phase 29 verification evidence

- The initial desktop E2E failure was caused by the first service-worker activation claiming the page, which emitted `controllerchange` and reloaded `/login` before Better Auth received its sign-in request. The lifecycle now reloads only after the user explicitly selects `Update now` for a waiting worker; initial installation never reloads the page.
- The final `corepack pnpm verify` pass completed Prettier, ESLint, 29 Vitest files and 132 tests, Prisma validation/client generation, strict TypeScript, and the 76-route production build.
- The final `corepack pnpm test:integration` pass reset the isolated database, applied all 39 migrations, and passed 2 files and 7 database-backed tests.
- The final `corepack pnpm test:e2e` pass reset and seeded the disposable database, then passed all 10 single-worker Chromium checks: Better Auth login/failure/logout, protected routing, RBAC, desktop navigation/print pages, manifest/icons, service-worker static/offline fallback behavior, offline submission rejection, and the complete 360px/390px/430px/tablet responsive workflow. The four captured responsive renders were visually inspected.
- The Phase 28 backup drill was not rerun because Phase 29 did not change backup/restore production code.

### Completed Phase 28 baseline

**Phase 28 status:** COMPLETE

### Implemented Phase 28 boundary

- PostgreSQL custom-format backups use one exported database snapshot and publish a SHA-256 manifest only after `pg_dump` and `pg_restore --list` succeed. Manifests include non-secret server/tool/application/migration metadata plus representative exact source facts.
- Restore verifies identifier/path safety, manifest structure, byte size, and checksum before any destructive action. Automated targets must contain both restore and test markers and cannot equal the source, development, or PostgreSQL system databases.
- Post-restore inspection verifies expected tables and migrations, exact source/restored counts and totals, posted journal balance, AR/AP controls, inventory GL/valuation agreement, completed-batch WIP, inventory health, and audit preservation.
- Retention operates only on validated regular-file backup pairs directly inside the configured backup root. The managed drill uses `factory_erp_test` as source and the separate `factory_erp_restore_test` target, including checksum-corruption and invalid-target rejection.
- Scheduling, production promotion, deployment, PWA, Tailscale, and off-site/cloud transport remain outside Phase 28. Operator guidance is in `docs/operations/backup-and-recovery.md`.

### Phase 28 verification evidence

- The initial verification pass stopped at TypeScript because the `pg` runtime dependency lacked directly installed declarations. The narrow final correction adds official `@types/pg` declarations without changing backup/restore production behavior.
- The final `corepack pnpm verify` passed Prettier, ESLint with zero warnings, 29 Vitest files and 132 tests, Prisma validation/client generation, strict TypeScript, and the 75-route production build.
- `corepack pnpm test:integration` reset the isolated source database, applied all 39 migrations, and passed 2 files and 7 database-backed tests.
- `corepack pnpm backup:drill` created and verified a custom-format backup, rejected unsafe targets and a bad checksum before mutation, retained only eligible backup pairs, restored into `factory_erp_restore_test`, matched migrations/source facts, and passed journal, AR, AP, inventory, WIP, inventory-health, and audit checks.
- Chromium E2E was not rerun because Phase 28 changes only server-side operational scripts; the unchanged Phase 27 baseline remains 7 passing checks.
- Phase 28 is complete. Scheduling, off-site copying, production recovery promotion, and the provisional RTO remain manual operational boundaries rather than automated guarantees.

### Completed Phase 27 baseline

### Implemented Phase 27 boundary

- An isolated native PostgreSQL 16 cluster runs at `127.0.0.1:55433/factory_erp_test`, with ignored storage under `.test-data/`. Managed lifecycle commands cannot target a custom or development endpoint and reset only the explicitly test-named database.
- Deterministic seeding creates test identities and required master/accounting references without directly inserting completed operational transactions. The shared golden workflow uses supported repositories and posting services for purchasing/QC, transfer, production/costing, sales/dispatch/invoice, customer payment/reversal/return, and supplier payment/reversal.
- Serial database integration checks control-account reconciliation, journal balance, PostgreSQL immutability, reversal-chain rejection, over-return protection, and representative idempotency/atomicity.
- Playwright Chromium covers real Better Auth login/logout/failure, protected routing, restricted-viewer RBAC, major desktop routes, printable documents/reports, and the mobile navigation shell. It uses one worker, no retries, semantic locators, and temporary-directory failure artifacts.
- Docker was unavailable, so the equivalent disposable lifecycle uses installed PostgreSQL server binaries. Fresh resets also identified two PostgreSQL migration defects: an earlier idempotent enum migration fixes the Phase 13 enum-order issue without changing the historical migration, and the Phase 27 packaging-integrality migration replaces an impossible fixed-scale `scale(...) = 0` check with an equivalent whole-piece value check.

### Phase 27 completion evidence

- `corepack pnpm verify` passed Prettier, ESLint (with four existing non-fatal unused-argument warnings), Vitest (28 files and 118 tests), Prisma validation/client generation, strict TypeScript, and the 75-route production build.
- `corepack pnpm test:integration` reset the isolated `factory_erp_test` database, applied all 39 migrations, and passed 2 files and 7 database-backed tests covering the golden workflow, reconciliation, immutability, reversal, idempotency, and over-return protection.
- `corepack pnpm test:e2e` reset the same isolated database, seeded the supported workflow, and passed all 7 single-worker Chromium checks: authentication, protected routing, logout, RBAC, desktop navigation and printable pages, and mobile navigation.
- `git diff --check` passed after the final documentation update.

### Phase 26 final-correction verification

- The production-yield and valuation quantity-effect expectations match the established canonical Decimal serialization. The final Vitest run passed all 28 files and 118 tests.
- Nullable accounting-period behavior and Prisma-style `createMany` arguments are modeled explicitly in the test doubles. The final `corepack pnpm verify` pass completed Prettier, ESLint, Vitest, Prisma validation/client generation, TypeScript, and the 75-page production build.

### Completed Phase 26 testing boundary

- Vitest remains the only automated test framework. The fast Node suite now covers exact quantity/carton/pricing math; inventory reservation, dispatch, invoice outflow, receipt/QC and production custody; purchasing fulfilment; production reconciliation/output/yield; customer settlement and reversal effectiveness; moving weighted-average valuation; production costing; balanced automatic accounting; closed-period/control-account blocking; and authoritative reversal-chain rules.
- Transaction-oriented tests use deterministic in-memory boundary doubles to prove atomic no-write failures and source idempotency without connecting to a normal database. A shared balanced-journal assertion is used across representative sales, supplier-payment, expense, treasury-transfer, and customer-payment-reversal flows.
- `vitest.integration.config.ts` provides a separate database-backed suite. It requires an explicit `TEST_DATABASE_URL`, rejects the development URL and unsafe/non-test database names, and is excluded from the normal suite. A disposable migrated test database is not configured in this environment, so PostgreSQL-backed multi-ledger workflow and immutability-trigger execution remain an explicit gap rather than using development data.
- No browser E2E framework, new posting flow, or Phase 27 product scope was introduced. See `docs/testing/core-test-strategy.md` for the concise test boundary and safe database command.

### Reviewed Phase 25 baseline

### Existing Phase 24 financial reporting boundary

- `/accounting/reports` provides protected, printable financial statements and operational-finance reports: Profit & Loss, Balance Sheet, Cash Flow, receivable and payable aging, inventory valuation and GL reconciliation, WIP/production costing, product profitability, and expense/treasury analysis. Every page is server-rendered behind `accounting.view` and applies the requested accounting-date filter to POSTED journals or the corresponding authoritative POSTED/FINAL source ledger.
- `src/server/accounting/financial-reporting.ts` is the single calculation layer used by the reports and management dashboard. It uses exact `Decimal` arithmetic, account mappings rather than UI-held values, source-linked journal lines, customer/supplier allocation state, valuation entries, and finalized batch-cost snapshots. It distinguishes sales discounts from sales returns and exposes reconciliation differences instead of modifying them.
- The accounting landing page now presents a management snapshot of year-to-date profit, cash and bank, AR, AP, inventory value, open periods, and unresolved posting blocks, with links to the detailed reports.

### Existing Phase 24 controlled-close boundary

- Migration `20260831050000_phase24_period_close_audit` adds immutable accounting-period close/reopen events with actor and mandatory reopen reason.
- Close/reopen remains restricted to `accounting.manage`. The server closes only OPEN periods and blocks closure when the period trial balance is unequal, unresolved posting blocks were raised in the period, in-period valuation is not FINAL, or a comparable control-account reconciliation differs. Draft journals are shown as an explicit warning because they are not included in statements.
- Existing central OPEN-period guards remain the decision point for new journal posting. Reopening a closed period is a recorded exception; no posted transaction is deleted or rewritten by the reporting or close workflow.

### Completed Phase 25 audit/control boundary

- Migration `20260831060000_phase25_audit_control_framework` adds typed, append-only `AuditEvent` records with server-resolved actor identity, stable actions/entity types/reason codes, indexed search fields, sensitive-field scrubbing, and a PostgreSQL update/delete rejection trigger.
- High-risk lifecycle coverage is complete for managed users and role permissions; manual inventory adjustments and transfers; purchase orders, receipts, QC, returns, and quarantine; recipes, batches, material/packaging/output transactions; valuation and costing; sales orders, dispatch/delivery, invoices, customer payments/allocations/reversals, and returns; supplier payments, expenses, treasury transfers, journals, accounting periods, and mapping controls. Cancellation, reversal, reopen, and override events require a meaningful server-validated reason.
- Source repositories own operational lifecycle events. Automatic accounting records a distinct JOURNAL event linked to its source; missing settings, open period, tax-policy support, or usable account mappings produce an attributable CONTROL_BLOCKED event and persistent posting block. Customer-payment, supplier-payment, expense, treasury-transfer, and manual-journal reversals create linked compensating documents/journals instead of mutating posted truth.
- Database-backed document sequences provide unique operational and financial references, while PostgreSQL immutability guards prevent posted document headers, lines, allocations, journals, and audit history from being rewritten or deleted through supported workflows.
- `/administration/audit-log` provides protected server-backed search, detail, and recent-control visibility. Audit metadata recursively removes credential-like fields, and PostgreSQL rejects audit-event updates and deletes.

### Scope boundaries

- Reports disclose source/GL differences and manual cash movement instead of silently repairing them. No bank-statement import or reconciliation, refunds, credit notes/debit notes engine, fixed assets, payroll, budgeting/forecasting, multi-currency, tax filing, or new transaction-posting engine was introduced.
- Aging is based on posted open invoices/payables net of economically effective payment allocations at the selected as-of date; completed Sales Return credits also reduce customer invoice outstanding. Historical allocations attached to reversed payments remain immutable but no longer settle their target. Inventory historical views reconstruct the last valuation state per item from valuation entries at that date.

### Prior Phase 24 verification evidence

- `corepack pnpm prisma validate` and `corepack pnpm prisma generate` passed.
- `corepack pnpm prisma migrate deploy` applied `20260831050000_phase24_period_close_audit`; `corepack pnpm prisma migrate status` then reported 34 migrations and a schema up to date.
- `corepack pnpm db:check` completed a PostgreSQL query successfully.
- `corepack pnpm typecheck`, `corepack pnpm lint`, `corepack pnpm format:check`, `corepack pnpm build`, and `git diff --check` passed. The production build registered every Phase 24 report route.
- Automated tests were intentionally not run because the approved Phase 24 scope forbade them.

### Phase 25 completion evidence

- The payment-settlement correction uses one exact customer-invoice calculation including completed return credits, makes reversed customer/supplier payment allocations historical but economically ineffective in current and as-of views, permits allocated supplier-payment reversal without a second cash movement, and blocks reversal-of-reversal chains for customer/supplier payments, expenses, and treasury transfers. The direct application seam has focused authorization/delegation coverage.
- `corepack pnpm verify` passed Prettier, ESLint, Vitest (16 files and 48 tests), Prisma validation/client generation, TypeScript, and the 75-page production build on the corrected Phase 25 source state.
- `corepack pnpm prisma migrate deploy` applied `20260831080000_phase25_payment_reversal_integrity`; `corepack pnpm prisma migrate status` then reported 37 migrations and a schema up to date. `corepack pnpm db:check` completed a PostgreSQL query successfully.
- A read-only `prisma db execute` assertion confirmed the non-internal `audit_event_append_only` trigger is installed. `git diff --check` passed.

## Pre-Phase-33 runtime stabilization

**Runtime Stabilization is COMPLETE.**

- The PostgreSQL warning was reproduced through the Phase 27 golden workflow and isolated to Prisma-generated concurrent relation SELECTs inside an interactive transaction. A focused integration regression captures the exact nested goods-receipt include path. Enabling supported pg pipeline mode removed the warning without changing domain queries, isolation, ledgers, journals, reversals, RBAC, or audit behavior.
- Sanitized Playwright observation covers browser `console.error`, uncaught page errors, failed same-origin requests, and same-origin HTTP 5xx responses. It passed 24 authenticated major/seeded routes and representative invalid master, multi-line transaction, and account-security forms.
- The active-action audit in `docs/testing/runtime-action-audit.md` records no known broken active action. Planned navigation remains outside this stabilization boundary for the following workflow inventory.
- Representative route measurements used one warm-up and three samples. Stable request counts and sub-second medians did not demonstrate a structural performance defect, so no speculative optimization was made. Exact measurements are in `docs/testing/runtime-performance-baseline.md`.
- Playwright's inherited `NO_COLOR` conflict was removed at the test-config boundary; controlled server output no longer emits that Node environment warning. The deliberate invalid-password authentication test still produces its expected non-error authentication warning.
- Final closure evidence on 2026-09-09: the fresh traced integration gate passed 14 tests with one explicitly infrastructure-gated skip and no concurrent `client.query()` warning; `corepack pnpm test:e2e` passed 17/17 with no unexpected Node/server exception, browser application error, same-origin request failure, or HTTP 5xx; `corepack pnpm verify` passed formatting, ESLint, Prisma validation/generation, TypeScript, 226 unit tests with 2 skipped, and the 78-page production build; `git diff --check` passed. The build required the established maintenance-window stop because the healthy scheduled production runtime held `.next/standalone`; this operational lock was not an application runtime defect.

## Workflow inventory

The final sidebar/workflow classification is recorded in `docs/testing/workflow-inventory.md`: 58 `COMPLETE`, 0 `BACKEND EXISTS / UI INCOMPLETE`, 0 `PARTIAL`, and 0 `MISSING` across all 58 sidebar entries. Every sidebar workflow, including Receivables, Payables, Material Issues, Packaging Consumption, Reprocess, Waste & Damage, Purchase Invoices, and Administration Settings, is now a complete, tested, first-class workbench. The duplicate Journal Vouchers entry was removed.

## Navigation and Data Entry UX closure

**Navigation / Data Entry UX is READY. Tasks 1–9 are COMPLETE.**

- Shared searchable selection, pending/single-flight submission, Save/Cancel action, line-editor, feedback, and quick-create patterns are adopted across the approved inventory, purchasing, production, sales, accounting, and access screens without changing domain authority.
- Receivable and payable workbenches remain read-only projections over authoritative subledgers and launch the existing payment engines. Material and packaging workbenches route into the existing batch transaction engines; no duplicate posting engine was added.
- Final closure evidence on 2026-09-12: `corepack pnpm verify` passed Prettier, ESLint, Prisma validation/generation, TypeScript, 265 unit tests with 2 skips, and the 85-page Next production build. Traced integration passed 15 tests with 1 documented infrastructure-gated skip and no concurrent-client-query or unexpected Node/database warning. Disposable-DB Playwright passed 26/26 with one worker, zero retries, no browser, hydration, Node/server, or destination-stream error, and only the deliberate invalid-password warning.
- The canonical `HamdFoodsERP` task was restarted after the port-clear build window. It is running with its sole listener on `127.0.0.1:3100`; `/api/health` returns `200 {"status":"ok"}`; production auth bypass is disabled; the read-only production business counts match the certified pre-test baseline.
- Phase 33 was not started, and the remaining 2 `PARTIAL` plus 2 `MISSING` workflows were not implemented or relabeled.

## Next gate

**All 58 sidebar workflows are COMPLETE. Phase 33 is NOT STARTED.** With Purchase Invoices and Administration Settings closed, the functional workflow inventory is exhausted: 0 `PARTIAL`, 0 `MISSING`. The documented next steps are full functional UAT, production/manual workflow UAT, and re-certification of the complete ERP, followed by Phase 33 (not yet scoped or started). Phase 31 authorized/unauthorized remote-device acceptance and mobile PWA acceptance remain deferred by the operator to final UAT.

### Production deployment note (resolved 2026-09-14)

The production-migrate action was initially blocked by this environment's own permission control (see the original incident record in `progress.md`). On retry it succeeded: `prisma migrate deploy` applied `20260914170607_purchase_invoices_matching_variance` cleanly, the `HamdFoodsERP` task was restarted, and health/listener/route checks all passed with zero business-data mutation beyond the additive schema change. Production is fully synced as of this closure.
