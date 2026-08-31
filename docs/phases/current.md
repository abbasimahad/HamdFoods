# Current phase

## Phase 27 - Database Integration, Browser E2E & Full Workflow Regression

**Status:** COMPLETED

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

## Next gate

**Phase 28 is not started.** It may become the next gate only after Phase 27's final verification evidence is recorded; it must preserve the server-authoritative accounting, inventory, valuation, sequencing, reversal, immutability, audit, and test-database safety boundaries.
