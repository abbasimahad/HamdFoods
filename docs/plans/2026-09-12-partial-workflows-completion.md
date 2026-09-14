# Reprocess and Waste & Damage Implementation Plan

> Execute inline and sequentially. Do not begin Waste & Damage behavior until Reprocess is green. Use only the disposable test database for mutation integration/E2E tests.

**Goal:** Complete the two current PARTIAL production workflows without implementing Purchase Invoices, Administration Settings, or Phase 33.

**Architecture:** A `ReprocessDocument` owns source-FG reservation/consumption, genealogy, frozen shelf-life policy, yield snapshot, and independent QC around one explicitly REPROCESS-classified linked `ProductionBatch`. Existing batch engines retain material, packaging, output, WIP, costing, valuation, and accounting authority. A separate `WasteDisposition` document owns only controlled status disposition and final valued write-off through central ledger/accounting services.

**Stack:** TypeScript, Next.js 16 App Router/Server Actions, React 19 forms, Prisma 7, PostgreSQL, Decimal.js, Vitest, Playwright.

## Task A — Schema, RBAC, and product policy

**Files:**

- Modify: `src/modules/access/domain/permissions.ts`
- Modify: `src/modules/access/domain/default-roles.ts`
- Modify: `src/modules/access/domain/authorization.test.ts`
- Modify: `src/modules/master-data/application/contracts.ts`
- Modify: `src/modules/master-data/application/manage-master-data.ts`
- Modify: `src/server/master-data/prisma-master-data-repository.ts`
- Modify: existing finished-good form/page files under `src/components/inventory` and `src/app/(erp)/inventory/finished-goods`
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260912xxxxxx_partial_workflow_foundation/migration.sql`
- Create/modify: focused domain/schema tests next to access, master-data, and production contracts

1. Add failing tests for `quality.manage`, conservative default-role grants, nullable/positive/immutable product policy behavior, explicit NORMAL/REPROCESS batch classification, one-to-one document/batch relations, genealogy/QC/disposition schema contracts, and normal-batch compatibility.
2. Run focused Vitest and record RED for missing behavior.
3. Add enums/models/relations/check constraints/sequence/audit and movement/accounting types required by the approved design. Add `reprocessShelfLifeDays Int?` without default/backfill.
4. Extend finished-good validation/repository/UI with a positive whole-day optional policy and existing `inventory.manage` authority.
5. Generate Prisma client; run focused tests, schema validation, typecheck; record GREEN.

## Task B — Reprocess eligibility and reservation

**Files:**

- Create: `src/modules/production/domain/reprocess.ts`
- Create: `src/modules/production/domain/reprocess.test.ts`
- Create: `src/modules/production/application/reprocess-contracts.ts`
- Create: `src/modules/production/application/manage-reprocess.ts`
- Create: `src/modules/production/application/manage-reprocess.test.ts`
- Create: `src/server/production/prisma-reprocess-repository.ts`
- Modify: `src/server/inventory/transactional-inventory-posting.ts`
- Modify/create: focused inventory-posting and disposable-DB integration tests

1. RED: FINISHED_GOOD/production-lot/source-expiry/policy/status/quantity eligibility; exact one batch; DRAFT no stock; competing reservation blocked; cancellation releases exactly once; snapshots immutable.
2. Implement one shared eligibility policy used later by Waste & Damage.
3. Implement Serializable DRAFT creation and REPROCESS batch creation, lot-layer reservation, source keys, audit, and safe DRAFT/RESERVED cancellation.
4. GREEN focused unit and integration slice before continuing.

## Task C — Source finished good to WIP

**Files:**

- Modify: Reprocess domain/application/repository files from Task B
- Modify: `src/server/inventory/transactional-inventory-posting.ts`
- Modify: `src/server/costing/prisma-inventory-valuation-repository.ts`
- Modify: `src/server/accounting/transactional-accounting-posting.ts`
- Add/modify: focused inventory, valuation, accounting, production, and integration tests

1. RED: reserved source moves to linked-batch WIP once; source production lot/document/batch genealogy remains complete; original lot unchanged; source carrying value enters WIP once; duplicate start is rejected/idempotent; no raw/packaging contract accepts FINISHED_GOOD.
2. Add dedicated central source-FG posting/valuation/accounting bridge with unique source keys and existing period/account mapping authority.
3. Add pre-activity compensating start reversal and downstream guards.
4. GREEN focused and integration slices; reconcile quantity/value/journal/audit.

## Task D — Linked production execution

**Files:**

- Modify narrowly: production batch/material/packaging/output contracts and Prisma repositories only where REPROCESS classification requires branching
- Modify: corresponding focused tests
- Add: linked-batch integration coverage

1. RED: linked batch uses existing additional material, packaging, return, output, and cost APIs; normal batches remain unchanged; source FG never enters raw/packaging transaction contracts.
2. Add the minimum classification-aware branches and read-model links.
3. GREEN all production focused tests and linked-batch integration slice.

## Task E — Child lot, expiry, and yield

**Files:**

- Modify: `src/server/production/prisma-production-output-repository.ts`
- Modify: `src/server/production/prisma-reprocess-repository.ts`
- Modify: `src/server/inventory/transactional-inventory-posting.ts`
- Modify/create: output/reprocess domain and integration tests

1. RED: reprocess GOOD makes a distinct child lot in QUALITY_HOLD; bidirectional genealogy; exact source content = GOOD + scrap + process loss; both expiry-minimum cases; no override/recalculation; completion actor/status snapshots.
2. Implement reprocess-only output destination and system-derived child dates; keep NORMAL output AVAILABLE.
3. Implement exact completion reconciliation and AWAITING_QC transition in one Serializable authority.
4. GREEN focused and integration tests.

## Task F — Cost finalization

**Files:**

- Modify: `src/modules/costing/domain/production-costing.ts` and tests
- Modify: `src/modules/costing/application/contracts.ts`
- Modify: `src/server/costing/prisma-inventory-valuation-repository.ts`
- Modify: `src/server/accounting/transactional-accounting-posting.ts`
- Modify: costing/accounting integrity and integration tests

1. RED: recoverable reprocess output gets traceable valuation-equivalent basis; source-FG value plus existing inputs/costs enters one pool; total capitalization unchanged; missing versus zero basis; child output finalized; no duplicate journals.
2. Extend the existing batch cost calculation/finalization and automatic journal source mapping; do not add a parallel cost ledger.
3. GREEN costing/accounting focused and integration suites.

## Task G — Independent quality approval

**Files:**

- Modify: Reprocess contracts/domain/application/repository
- Create: `src/app/(erp)/production/reprocess/actions.ts` initially for direct-action tests
- Create/modify: quality/lifecycle unit and disposable-DB integration tests

1. RED every QC gate, `quality.manage`, initiator/completer self-approval denial including SUPER_ADMIN, decision once, APPROVED release, REJECTED quarantine, immutable QC, and direct action invocation.
2. Implement one atomic QC decision/status posting with finalized batch/cost/valuation/accounting/policy/expiry/genealogy rechecks.
3. GREEN focused and integration tests. Mark Workflow #1 backend complete only after all Reprocess invariants pass.

## Task J1 — Reprocess UI and E2E

**Files:**

- Create: pages under `src/app/(erp)/production/reprocess`
- Create: Reprocess form/action components under `src/components/production`
- Modify: `src/config/navigation.ts`, route constants, and navigation tests
- Modify: Playwright seed/fixtures/specs under `e2e` and `src/test` as applicable

1. RED route/navigation/component/E2E behavior for list/new/edit/detail/reserve/start/open-batch/QC and permission-safe states.
2. Build pages with the shared action-state, searchable-select, line/form, pending, duplicate-submit, Save/Cancel, and immutable-detail patterns.
3. Run focused unit, Reprocess integration, and Reprocess E2E. Inspect server/browser errors. Do not start Workflow #2 until green.

## Task H — Waste & Damage posting

**Files:**

- Create: `src/modules/inventory/domain/waste-disposition.ts` and tests
- Create: `src/modules/inventory/application/waste-disposition-contracts.ts`
- Create: `src/modules/inventory/application/manage-waste-dispositions.ts` and tests
- Create: `src/server/inventory/prisma-waste-disposition-repository.ts`
- Modify: central inventory/valuation/accounting posting files
- Create/modify: disposable-DB integration tests

1. RED DRAFT/cancel/immutability, reasons, permission, action/status matrix, lot balances, shared Reprocess eligibility, MOVE_TO_REPROCESS handoff without duplicate custody, no premature valuation/accounting, WRITE_OFF exact quantity/current authoritative value/balanced unique loss.
2. Implement Serializable header/line posting through central authorities with inventory.manage only.
3. GREEN focused and integration slices.

## Task I — Waste & Damage reversals

**Files:**

- Modify: Waste domain/application/repository and central valuation/accounting services
- Modify/create: reversal integrity and integration tests

1. RED exact compensating MOVE_TO_SCRAP, MOVE_TO_REPROCESS downstream claim block, WRITE_OFF original-value restoration/accounting reversal, period-close block, immutable original, audit.
2. Implement linked reversal documents using original movement/valuation/journal provenance, never current cost.
3. GREEN focused and integration slices.

## Task J2 — Waste & Damage UI and E2E

**Files:**

- Create: pages under `src/app/(erp)/production/waste-damage`
- Create: disposition form/actions under `src/components/inventory` or `src/components/production`
- Create: `src/app/(erp)/production/waste-damage/actions.ts`
- Modify: navigation/routes/tests and Playwright coverage

1. RED list/new/edit/detail and lifecycle/action behavior.
2. Implement shared multi-line form/search/pending/duplicate-submit/permission patterns and immutable posted detail/history.
3. GREEN focused, Waste integration, and Waste E2E; inspect server/browser errors.

## Final documentation, verification, production recheck, and delivery

**Files:**

- Modify: `docs/testing/workflow-inventory.md`
- Modify: `docs/phases/current.md`
- Modify: `progress.md`
- Modify: architecture/glossary/testing docs where contracts changed
- Update: this plan's checkboxes/evidence as execution proceeds

1. Run full required gates exactly: `corepack pnpm test`; traced integration; E2E; `corepack pnpm verify`; `git diff --check`.
2. Confirm zero retries, no concurrent-query warning, no application server/browser errors, balanced ledgers/WIP, and complete genealogy.

## Execution checkpoint - 2026-09-13

- Tasks A-I: COMPLETE with disposable PostgreSQL evidence.
- Task J1/J2: COMPLETE; active list/new/edit/detail/QC routes, searchable/filterable workbenches, single-flight actions, permission-safe lifecycle controls, and responsive custody/provenance views are implemented.
- Browser evidence: 30/30 single-worker Chromium checks passed with zero retries at desktop/mobile sizes; 768px containment was also asserted and captured 375/1280 renders were inspected.
- Workflow inventory: reconciled from 55 COMPLETE / 2 PARTIAL / 2 MISSING to 57 COMPLETE / 0 PARTIAL / 2 MISSING. The two MISSING workflows remain untouched.
- Final gates passed: 309 unit tests / 2 skips, 27 integration tests / 1 intentional skip, 30/30 Chromium E2E, Prisma validation/generation, TypeScript, ESLint, Prettier, 89-page production build, and clean diff checking. Production/Git synchronization follows the established backup-first release procedure.

3. Update inventory only after evidence: COMPLETE 57, backend/UI incomplete 0, PARTIAL 0, MISSING 2, total 58, planned labels 2.
4. Perform read-only production status/health/listener/PostgreSQL/auth-bypass/data recheck. If build locking occurs, use the documented maintenance stop/build/start procedure and restore health.
5. Inspect every changed file and the full diff; run source/secret hygiene checks; commit and push normally; fetch and prove `HEAD == origin/main` and clean worktree.
