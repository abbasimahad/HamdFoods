Plan: docs/plans/2026-09-09-navigation-data-entry-ux.md
Task 1: COMPLETE (4 unit + 19 E2E; typecheck and diff check pass)
Task 2: COMPLETE (15 focused + 21 E2E; typecheck and diff check pass)
Task 3: COMPLETE (10 focused + live reconciliation integration; typecheck and diff check pass)
Task 4: COMPLETE (read-only AR/AP list/detail and authoritative payment launch routes implemented)
Task 5: COMPLETE (3 focused tests; first-class material/packaging workbench routes reuse batch engines)
Task 6: COMPLETE (shared adoption contract covers master, purchasing, and inventory representatives)
Task 7: COMPLETE (production/sales shared controls; lifecycle invariant tests pass)
Task 8: COMPLETE (accounting/access shared controls; integrity and authorization tests pass)
Task 9: COMPLETE (final unit, integration, E2E, build, production, inventory, and worktree gates pass)

Navigation / Data Entry UX: READY

Final closure evidence (2026-09-12):

- `corepack pnpm verify`: PASS — Prettier, ESLint, Prisma validate/generate, TypeScript, 265 unit tests passed with 2 skipped, and 85 generated production pages.
- traced integration: PASS — 15 passed / 1 documented infrastructure-gated skip; no PostgreSQL concurrent-client-query or unexpected Node/database warning.
- disposable-DB E2E: PASS — 26/26, one worker, zero retries, no browser, hydration, Node/server, or destination-stream errors; only the deliberate invalid-password warning.
- production: `HamdFoodsERP` running, sole listener `127.0.0.1:3100`, health `200 {"status":"ok"}`, production auth bypass disabled, and business row counts unchanged.
- workflow inventory: 55 COMPLETE, 0 BACKEND EXISTS / UI INCOMPLETE, 2 PARTIAL, 2 MISSING, 58 sidebar entries, 4 planned labels.
- `git diff --check`: PASS.

Prior gate: Runtime Stabilization COMPLETE.
Next subproject: PARTIAL WORKFLOWS. Phase 33 is NOT STARTED.

Partial Workflows closure (2026-09-13):

- Tasks A-J COMPLETE: Reprocess and Waste & Damage are active, end-to-end workflows.
- Reprocess preserves source-to-child genealogy, conservative shelf life, linked production/WIP costing, and independent QC authority.
- Waste & Damage controls scrap/reprocess/write-off disposition and safe compensating reversals using original value.
- Workflow inventory is reconciled to 57 COMPLETE, 0 PARTIAL, and the same 2 untouched MISSING workflows.
- Final verification passed: 309 unit tests / 2 skips, 27 integration tests / 1 intentional skip, 30/30 E2E, Prisma, TypeScript, ESLint, formatting, and the 89-page production build. Production/Git synchronization uses the established backup-first closure procedure. Phase 33 remains NOT STARTED.

Release closure (2026-09-14):

- Fresh verification repeated successfully: `corepack pnpm verify` passed 309 unit tests / 2 skips and the 89-page production build; disposable integration passed 27 / 1 intentional skip; Chromium E2E passed 30/30 with one worker and zero retries.
- Production backup `hamd_foods_erp_prod_drill-20260914T155829603Z-9a06f093` was created and SHA-256 verified before deployment. Migration `20260912223500_partial_workflow_foundation` applied successfully; all 40 production migrations are current.
- The canonical `HamdFoodsERP` task is running on the sole `127.0.0.1:3100` listener, health passes, recent logs contain no error/fatal match, and production auth bypass is disabled.

Purchase Invoices closure (2026-09-14):

- Design approved in `docs/specs/2026-09-14-purchase-invoices-design.md` (D1–D8 frozen, D6 amended). Implemented PO-line-anchored invoice matching against QC-completed GRN lines, price/tax variance true-up posting (no AP re-origination, no GRNI, no revaluation), DRAFT/POSTED/CANCELLED/REVERSED lifecycle, duplicate-invoice-number protection, and concurrency/idempotency guarantees under Serializable transactions.
- New migration `20260914170607_purchase_invoices_matching_variance`: `PurchaseInvoice`/`PurchaseInvoiceLine`/`PurchaseInvoiceLineMatch`/`PurchaseInvoiceSequence`, `PurchaseInvoiceStatus`, `PURCHASE_PRICE_VARIANCE` mapping, `PURCHASE_INVOICE_VARIANCE`/`PURCHASE_INVOICE_REVERSAL` source types, `PURCHASE_INVOICE_VARIANCE` supplier-ledger type, `PURCHASE_INVOICE` audit entity, and DB lifecycle/immutability/cross-reference guard triggers on the new tables only — no existing table, column, trigger, or posting function was altered.
- Tests: 16 domain + 15 application-layer unit tests; 13 new disposable-DB integration tests (exact match, price/tax variance both directions, tax-policy block, incomplete/partial/multi-GRN/multi-invoice matching, duplicate rejection, pre-GRN draft, concurrent over-invoicing, closed-period block vs. throw, immutability, audit, idempotency); 2 new Chromium E2E tests. Full gates: `pnpm verify` PASS (340 unit tests / 2 skips, 91-page build); disposable integration PASS (40 / 1 intentional skip); disposable E2E PASS (32/32).
- Workflow inventory reconciled to 58 `COMPLETE`, 0 `PARTIAL`, 1 `MISSING` (Administration Settings only).
- **Production deployment incomplete by design:** the production-migrate action was blocked by this environment's own permission control, and the follow-up attempt to revert the already-rebuilt production deployment back to the prior consistent build was also blocked. A verified pre-change backup was taken first. The production task was left **stopped** (safe: not serving code against an unmigrated schema) pending an operator decision to either apply the migration or redeploy the prior build. Code was not committed or pushed pending that decision.

Purchase Invoices production deployment (2026-09-14, follow-up):

- Retried `corepack pnpm production:migrate` after the earlier permission block; it succeeded this time. `prisma migrate deploy` applied `20260914170607_purchase_invoices_matching_variance` (41/41 migrations current), `HamdFoodsERP` task restarted, health `200 {"status":"ok"}`, sole `127.0.0.1:3100` listener, PostgreSQL loopback-only, no error/fatal in recent logs, `/purchasing/purchase-invoices` confirmed loading without a server error. No business data mutated beyond the additive schema change (verified backup `hamd_foods_erp_prod_drill-20260914T175438645Z-ad60729b.dump` retained as rollback point). `git status`/`rev-parse` confirmed `HEAD == origin/main`, worktree clean. Purchase Invoices closed as fully complete, code and production in sync.

Administration Settings closure (2026-09-15):

- Design approved (`docs/specs/2026-09-14-administration-settings-design.md`, D1-D5 as recommended). Full configuration/settings surface inspected; exactly one genuine, previously-unowned gap found: company/factory identity hardcoded as `"Hamd Foods ERP"` in 11+ files with no address/tax-ID/contact on any printed document. Implemented as a `CompanyProfile` singleton (same convention as `AccountingSettings`), gated by a new `settings.manage` permission (default `SUPER_ADMIN`/`ADMIN`), fully audited. Wired live into 8 print pages and the authenticated shell header/branding; explicitly not wired into the PWA manifest or root `<title>` (documented scope boundary). Numbering sequences, session policy, backup schedule, and logo upload were explicitly rejected as out of scope.
- New migration `20260914185802_administration_settings_company_profile`: `CompanyProfile` table (seeded with the current hardcoded name, zero visible change on deploy), `COMPANY_PROFILE` audit entity type. No existing table, column, trigger, or posting function touched.
- Tests: 7 domain + 4 application-layer unit tests; 3 new disposable-DB integration tests (singleton integrity, audited save with before/after snapshots, zero cross-boundary effect on inventory/valuation/accounting/RBAC state); 2 new Chromium E2E tests.
- **Fix alongside this work:** a reproducible E2E hydration-mismatch failure led to discovering `Date#toLocaleString()` is locale-dependent between Node SSR and the browser. Fixed in the new Company Profile form and in the Purchase Invoice detail page (`postedAt`/`reversedAt`, introduced in the prior closure) with a new deterministic `formatDateTimeUtc()` helper. Twenty-two other pre-existing files use the same pattern without ever failing in this project's certified test history; left untouched rather than speculatively rewritten.
- Full gates: `pnpm verify` PASS (351 unit tests / 2 skips, 92-page build); disposable integration PASS (43 / 1 intentional skip, re-run twice for stability); disposable E2E PASS (34/34).
- Workflow inventory reconciled to 58 `COMPLETE`, 0 `PARTIAL`, 0 `MISSING` — every sidebar entry is now complete.
- Production: verified backup taken (`hamd_foods_erp_prod_drill-20260914T191640278Z-4b4e6a12.dump`), migration applied (42/42 current), task restarted, health/listener/routes verified clean, no business data mutated beyond the additive schema change.
- `git diff --check` PASS; `HEAD == origin/main`, worktree clean after commit and push.

Next: full functional UAT, production/manual workflow UAT, and ERP re-certification. Phase 33 remains NOT STARTED.

Full functional UAT and re-certification (2026-09-15):

- Verified the complete business flow end to end via the existing certified suite: Supplier → PO → GRN → QC → Purchase Invoice → Supplier Payable → Supplier Payment → Inventory → Production → Material/Packaging Consumption → Finished Goods → Reprocess → Waste & Damage → Sales Order → Dispatch → Sales Invoice → Customer Payment → Returns → Accounting → Reports, plus master data, transfers/adjustments, lot traceability, carton/piece math, valuation, WIP/costing, receivables/payables, reversals, period close, RBAC (including `quality.manage`/`settings.manage`), audit log, Administration Settings, print pages/company profile, account recovery, and desktop/mobile UX.
- Gates: `pnpm verify` PASS (Prettier, ESLint, Prisma validate/generate, 351 unit tests / 2 skips, TypeScript, 92-page build). Disposable integration PASS (43 / 1 intentional skip, 42/42 migrations applied). Disposable Chromium E2E PASS (34/34, one worker, zero retries). `git diff --check` PASS.
- Read-only production checks all passed: `HamdFoodsERP` Running, health `200 {"status":"ok"}`, sole `127.0.0.1:3100` listener, PostgreSQL loopback-only (`127.0.0.1`/`::1:5432`), `AUTH_BYPASS_ENABLED` unset (defaults disabled), migrations 42/42 current with none pending, zero error/fatal/exception matches in recent application logs. No production business data was read-write touched; only status/health/log checks and an idempotent `migrate deploy` (no-op, already current) were performed.
- Documentation cross-checked against source: `docs/testing/workflow-inventory.md`, `docs/phases/current.md`, `progress.md`, `AGENTS.md`, and `docs/product/overview.md` all correctly state 58/58 `COMPLETE`, 0 `PARTIAL`/`MISSING`; confirmed against `src/config/navigation.ts` directly (zero `status: "planned"` literals remain, only the type definition still permits it for future use).
- No defects found. Two benign, expected non-issues were observed and are recorded as such, not fixed: (1) the production health endpoint needs a few seconds after a Scheduled Task restart before responding, which is normal Next.js standalone boot time, not a fault; (2) `next-env.d.ts` toggles between `.next/types` and `.next/dev/types` depending on whether `next build` or `next dev` last ran, a stock Next.js dev-mode artifact with no functional effect, reverted to keep the worktree clean rather than committed.
- `git status`/`rev-parse` confirmed `HEAD == origin/main` (`0341dbc4d7add9da351831d23a9483a137a8280a`), worktree clean.

ERP re-certified: 58/58 workflows COMPLETE, all gates green, production healthy and in sync, no outstanding defects. Ready for Phase 33 planning; Phase 33 itself remains NOT STARTED.

Phase 33 design and implementation (2026-09-15):

- Design frozen in `docs/specs/phase33-software-protection-design.md` (D1-D7 approved, D2 amended to bound-at-signing activation). Implemented exactly per that design: Ed25519-signed offline license (`license.lic`) bound to a non-secret machine fingerprint, an 8-state license machine (`SETUP_GRACE`/`VALID`/`EXPIRY_GRACE`/`EXPIRED`/`MACHINE_MISMATCH`/`INVALID_SIGNATURE`/`TAMPERED_STATE`/`CLOCK_ROLLBACK`) with 14-day setup grace, 30-day expiry grace, and 15-minute clock-rollback tolerance, and DPAPI+HMAC-protected local state.
- Restricted mode blocks only ordinary business mutations via a new `src/server/auth/licensed-guards.ts` wrapper applied to every mutation `actions.ts` file except `account/security` and `administration/license` (which must remain available for account hygiene and license recovery). Every read-only `page.tsx` continues to import the unrestricted guard directly, so reads/reports/printing/backups/restore are unaffected by construction, not by convention.
- New `license.manage` permission and `/administration/license` panel (status, activation-request generation, import, local-state reset); new `LICENSE` audit entity type via migration `20260915143600_phase33_license_audit_entity_type` (additive `AlterEnum` only -- license data itself stays outside PostgreSQL and outside database backups by design).
- Vendor-side Ed25519 keypair generated (`scripts/licensing/generate-keypair.ts`); the public key is embedded in `src/server/licensing/public-keys.ts`, the private key lives only in the gitignored `.licensing/` directory and never enters the repository, installer payload, or shipped application.
- `Setup-HamdFoodsERP.ps1` gained an optional `-LicenseFile` staging parameter (never a hard blocker to installation); no Inno Setup wizard UI was added for it in this pass since the primary intended flow is post-install activation from the License panel, not a pre-supplied file at setup time.
- Tests: 26 domain unit tests, 5 Ed25519 sign/verify tests, 5 `licensed-guards` wrapper tests, and 21 live-Windows integration tests exercising the real DPAPI bridge, real machine-fingerprint script, and real Ed25519 verification end-to-end through the full `license-service.ts` orchestration layer (no mocking of the OS boundary). `pnpm verify` passed Prettier, ESLint, Prisma validate/generate, the full unit suite, and TypeScript.
- Licensing enforcement activates only when `APP_ENV=production` on Windows, matching every other native-production-only invariant in `src/server/env.ts`; development, test, and CI are always unrestricted.
- Workflow inventory reconciled to 59 `COMPLETE`, 0 `PARTIAL`/`MISSING` (License added under Administration).
