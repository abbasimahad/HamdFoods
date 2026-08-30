# Phase 22 Accounting & General Ledger Implementation Plan

> **For agentic workers:** Execute inline in the current session. Do not delegate or create a Git commit unless the user separately requests it. The user later authorized necessary tests and full verification.

**Goal:** Translate authoritative posted operational and valuation events into immutable, balanced, source-idempotent accounting journals with a usable general-ledger foundation.

**Architecture:** Accounting owns the chart, settings, periods, journals, supplier payable subledger, posting blocks, and read models. Source modules retain ownership of commercial, physical, customer-ledger, valuation, and production-cost facts; their posting transactions invoke the accounting translator with a Prisma transaction client. A controlled backfill invokes the same translator by stable source identity.

**Tech Stack:** TypeScript, Next.js App Router, Prisma/PostgreSQL, Decimal.js, Zod, existing RBAC and server actions.

## Global Constraints

- No agents, subagents, delegation, orchestration, adaptive loops, P&L, Balance Sheet, cash flow, supplier payments, bank reconciliation, payroll, multi-currency, or tax filing.
- PostgreSQL, inventory valuation, production-cost snapshots, and customer receivable ledger remain authoritative; journal amounts use exact decimals only.
- POSTED journals and their lines are immutable, balanced, source-linked, and source-idempotent. Manual control-account postings are blocked.
- Verification is limited to Prisma validation/client generation, migration/database checks, typecheck, lint, formatting, and production build.

---

### Task 1: Accounting persistence and integrity boundary

**Files:**

- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260831000000_phase22_accounting_general_ledger/migration.sql`
- Create: `src/modules/accounting/domain/accounting.ts`

**Consumes:** existing `User`, `Supplier`, `Customer`, `Item`, `ProductionBatch`, and exact-decimal conventions.
**Produces:** Account/Settings/Period/Journal/JournalLine/SupplierLedger/PostingBlock persistence, seeded default chart/settings, database constraints and immutability triggers.

- [x] Add strictly typed enums/models, foreign keys, unique source journal identity, period validation, and SQL triggers blocking posted journal/line mutation and deletion.
- [x] Seed PKR default accounts/settings without hard-coded account IDs in TypeScript services.
- [x] Define exact journal-line validation: at least two lines, positive total, a single debit-or-credit side per line, and balanced debit/credit totals.
- [x] Verify through Prisma validation/generation and migration application; inspect migration status and PostgreSQL connectivity.

### Task 2: Posting translator, backfill, and source transaction integrations

**Files:**

- Create: `src/server/accounting/transactional-accounting-posting.ts`
- Create: `src/server/accounting/prisma-accounting-repository.ts`
- Modify: valuation, purchasing, production, invoice, payment, and sales-return repository transaction paths

**Consumes:** posted operational source rows, `InventoryValuationEntry`, `ProductionCostEntry`, `ProductionBatchCostSnapshot`, settings, and an authenticated actor resolved by existing source repositories.
**Produces:** `postAccountingForSource(tx, source)` and `backfillAccounting(actor)` that create exactly one balanced POSTED journal or a durable `ACCOUNTING_POSTING_BLOCKED` reason.

- [x] Translate acquisition/GRNI/AP, returns/replacements, landed costs, valuation adjustments, consumption/WIP, production costs/output, invoices/COGS, payments, and return financial/COGS effects from source amounts only.
- [x] Keep internal custody/status movements journal-free; apply the open-period rule to live posting and an explicit backfill mode to historical events.
- [x] Update source transaction paths to invoke the translator only after their authoritative data is created and within the same database transaction.
- [x] Verify source uniqueness and balancing guards through typecheck, migration constraints, database connection, and full project verification.

### Task 3: Controlled accounting management and read models

**Files:**

- Create: `src/modules/accounting/application/contracts.ts`, `src/modules/accounting/application/manage-accounting.ts`
- Create: `src/app/(erp)/accounting/**/page.tsx`, `src/app/(erp)/accounting/actions.ts`
- Create: `src/components/accounting/*.tsx`
- Modify: `src/config/navigation.ts`, `src/app/(erp)/accounting/page.tsx`

**Consumes:** `accounting.view`/`accounting.manage`, accounting repository contracts.
**Produces:** Chart/settings/period and manual-journal management; journal browser/detail, general ledger, trial balance, reconciliation, dashboard, and backfill controls.

- [x] Enforce permission checks server-side; resolve actor identity server-side; validate all action inputs with Zod.
- [x] Require manual journals to balance and exclude control/inactive/non-posting accounts; reversal creates a linked, opposite POSTED journal with reason/date.
- [x] Derive balances from POSTED lines and reconcile AR/AP/inventory from their authoritative ledgers without automatic repair.
- [x] Verify the app build exposes all routes and retains server-side authorization checks.

### Task 4: Documentation, audit, and permitted verification

**Files:**

- Modify: `docs/phases/current.md`, `docs/architecture/data-integrity.md`, relevant finance/domain documentation, `progress.md`

**Consumes:** implemented schema, routes, migration, and command output.
**Produces:** concise Phase 22 authoritative rules, status, check evidence, deferred Phase 23 work, and a clean diff.

- [x] Document source authority, accounting control-account rules, periods, exact balancing, supplier-ledger sign convention, backfill blocks/idempotency, and deferred workflows.
- [x] Run user-authorized full verification plus migration status and `db:check`.
- [x] Inspect schema/database constraints and `git diff --check`; stop after Phase 22.
