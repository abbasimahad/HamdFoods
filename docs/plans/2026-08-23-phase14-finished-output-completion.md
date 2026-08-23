# Phase 14 Finished Output, Yield, Reprocess & Batch Completion Implementation Plan

> **For agentic workers:** Use the host's available task-by-task implementation workflow. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the physical production lifecycle with immutable finished output, non-saleable output, process loss, exact yield/reconciliation, production lots, final packaging variance, and controlled batch completion.

**Architecture:** Add one output transaction aggregate and one default finished production lot per batch. GOOD output posts canonical PCS to AVAILABLE; REPROCESS and REJECTED output post exact product-content quantities to REPROCESS and SCRAP respectively; PROCESS_LOSS records disappearance without a positive ledger movement. A production read model derives input/output reconciliation, yield, packaging standards from actual cartons/pieces, and traceability; completion recomputes it inside a Serializable transaction and requires zero batch custody plus an explicit explanation for incompatible or nonzero reconciliation.

**Tech Stack:** TypeScript, Next.js App Router, React server actions, Zod, Decimal.js, Prisma 7, PostgreSQL, Tailwind CSS.

## Global Constraints

- Work inline in the current workspace without agents, delegation, or orchestration.
- Do not create or run automated tests or aggregate commands that execute tests.
- Only IN_PROGRESS batches accept new output; posted output is immutable and only DRAFT may be cancelled.
- GOOD output must match the batch finished good and uses carton normalization with canonical PCS as the only saleable quantity.
- Use one default production lot per batch/product; explicit production date and optional expiry are retained and expiry cannot precede production date.
- REPROCESS and REJECTED outputs use the finished-good content dimension and never enter AVAILABLE; process loss creates no positive inventory.
- Mixed MASS/VOLUME raw inputs are never added and yield is unavailable unless every consumed input uses the output-content dimension.
- Batch completion requires posted good output, zero lot-specific IN_PRODUCTION custody, and explicit reconciliation explanation whenever dimensions are incompatible or the exact input/output difference is nonzero.
- Preserve Phase 12/13 histories and add no costing, valuation, accounting, sales, PWA, deployment, or reprocess-reuse behavior.

---

### Task 1: Output persistence, lot provenance, and PostgreSQL integrity

**Files:**

- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260823240000_phase14_production_output/migration.sql`
- Create: `prisma/migrations/20260823241000_phase14_output_integrity_guards/migration.sql`
- Create: `prisma/migrations/20260823242000_phase14_completion_custody_guard/migration.sql`
- Create: `prisma/migrations/20260823243000_phase14_output_quantity_guards/migration.sql`

**Interfaces:**

- Produces: ProductionOutputTransaction, ProductionLot, output/loss classifications, completion metadata, and output provenance on InventoryMovement.

- [x] Add GOOD/REPROCESS/REJECTED/PROCESS_LOSS and DRAFT/POSTED/CANCELLED records with exact quantities, carton/loose fields, loss classification, actor lifecycle, and PO-YYYY numbering.
- [x] Add one production lot per batch with finished-good/recipe/date/expiry provenance and link output movements directly to the output transaction and production lot.
- [x] Permit IN_PROGRESS -> COMPLETED only with completion actor/time, posted GOOD output, and zero IN_PRODUCTION movements; block output changes outside DRAFT and enforce complete movement sets and correct saleable/non-saleable status/unit semantics.
- [x] Validate/generate Prisma and deploy all Phase 14 migrations to the configured development database.

### Task 2: Exact output, yield, and final packaging calculations

**Files:**

- Create: `src/modules/production/domain/output-calculations.ts`
- Create: `src/modules/production/application/output-contracts.ts`
- Create: `src/modules/production/application/manage-output-transactions.ts`

**Interfaces:**

- Produces: carton/content normalization, exact reconciliation/yield, final Packaging BOM usage, output repository port, and authenticated mutations/completion.

- [x] Normalize GOOD cartons/loose to positive PCS and exact net content; normalize other outputs only within the batch product-content dimension.
- [x] Derive actual raw input only when all posted raw consumption dimensions match product content; otherwise retain component totals and mark yield incompatible.
- [x] Derive good/recoverable yield, process-loss percent, expected-yield point difference, accounted output, and unreconciled input difference with exact decimals.
- [x] Derive final packaging standard from actual posted good pieces for PER_PIECE and actual posted cartons for PER_CARTON, retaining planned and both final variance measures.

### Task 3: Central output posting, repository, and safe completion

**Files:**

- Modify: `src/modules/inventory/domain/inventory.ts`
- Modify: `src/server/inventory/transactional-inventory-posting.ts`
- Modify: `src/server/inventory/prisma-inventory-repository.ts`
- Create: `src/server/production/prisma-production-output-repository.ts`

**Interfaces:**

- Produces: `postProductionOutputInventory`, class-specific output posting, output view/history/lineage, and `completeBatch`.

- [x] Post GOOD as AVAILABLE PCS, REPROCESS as REPROCESS product-content quantity, REJECTED as SCRAP product-content quantity, and no movement for PROCESS_LOSS through the central Serializable inventory authority.
- [x] Create/reuse the batch production lot and output movement atomically, preserve actor/batch/transaction/lot provenance, and support multiple postings without overwriting history.
- [x] Keep stock-overview balances separate by canonical unit so finished PCS and bulk non-saleable quantities cannot be combined.
- [x] Recompute custody, posted output, reconciliation, packaging mismatches, and explanation requirements inside completion before setting COMPLETED actor/time atomically.

### Task 4: Protected output, reconciliation, traceability, and completion UI

**Files:**

- Create: `src/components/production/output-transaction-form.tsx`
- Create: `src/components/production/output-transaction-actions.tsx`
- Create: `src/app/(erp)/production/batches/[id]/output/actions.ts`
- Create: `src/app/(erp)/production/batches/[id]/output/page.tsx`
- Create: `src/app/(erp)/production/batches/[id]/output/[transactionId]/edit/page.tsx`
- Modify: `src/app/(erp)/production/batches/[id]/page.tsx`

**Interfaces:**

- Produces: production.view output/yield/lineage reads and production.manage draft/post/cancel/complete operations.

- [x] Provide GOOD carton/loose/date/expiry forms plus REPROCESS, REJECTED, and classified PROCESS_LOSS quantity forms with practical guidance.
- [x] Show cumulative output, net content, other output, input components, exact yield metrics or incompatible-basis warning, unreconciled difference, and expected-yield comparison.
- [x] Show planned and final packaging standards, total-depleted and good-consumption variances, and mismatch warnings without mutating Phase 13 history.
- [x] Show production lot, recipe version, consumed supplier lots, immutable history, completion blockers/explanation, and a read-only completed summary.

### Task 5: Documentation and permitted verification

**Files:**

- Modify: `docs/phases/current.md`
- Modify: `docs/architecture/data-integrity.md`
- Modify: `docs/product/domain-glossary.md`
- Modify: `progress.md`

**Interfaces:**

- Produces: authoritative Phase 14 physical-output and completion rules plus verification evidence.

- [x] Document output movements, production lots, non-saleable outputs, loss, yield formulas, final packaging variance, lineage, completion, routes, migrations, and Phase 15 boundary.
- [x] Run only format/check, Prisma validate/generate/deploy/status, typecheck, lint, production build, live connectivity, focused exact-calculation execution, and static ledger/RBAC/scope scans.
- [x] Mark Phase 14 complete only after permitted gates pass and no known blocker prevents Phase 15.

## Unresolved Product Decisions

None. The prompt permits one default production lot per batch and explicit completion explanations where no tolerance policy exists; both choices preserve future extensibility without inventing costing behavior.
