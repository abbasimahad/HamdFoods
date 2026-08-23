# Phase 13 Packaging Issue, Consumption, Damage & Variance Implementation Plan

> **For agentic workers:** Use the host's available task-by-task implementation workflow. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add lot-preserving physical packaging issue, return, good consumption, and damage flows for IN_PROGRESS production batches with exact reconciliation and provisional variance.

**Architecture:** Extend the Phase 12 production-material transaction tables with an explicit RAW_MATERIAL/PACKAGING_MATERIAL class, optional raw or packaging snapshot provenance, DAMAGE metadata, and packaging-specific document sequences. Reuse the central Serializable inventory posting authority and immutable ledger, while keeping separate packaging application/read models and UI so Phase 12 behavior remains unchanged.

**Tech Stack:** TypeScript, Next.js App Router, React server actions, Zod, Decimal.js, Prisma 7, PostgreSQL, Tailwind CSS.

## Global Constraints

- Work inline in the current workspace without agents, delegation, or orchestration.
- Do not create or run automated tests or aggregate commands that execute tests.
- Only IN_PROGRESS batches may receive packaging operations.
- Only frozen Packaging BOM snapshot items are eligible; no arbitrary out-of-plan item path is introduced.
- DRAFT has no inventory effect; POSTED is immutable; only DRAFT may be cancelled.
- Preserve item, supplier lot, batch, transaction line, warehouse, canonical unit, actor, and timestamp provenance.
- Use the batch packaging warehouse with IN_PRODUCTION custody because no separate production-floor warehouse exists.
- COUNT packaging must remain integral; other supported quantity dimensions continue through the quantity engine.
- Damage moves IN_PRODUCTION to DAMAGED and requires a controlled reason; it does not scrap or destroy stock.
- Create no finished goods, actual output, yield, completion, costing, WIP valuation, or accounting effects.

---

### Task 1: Extend persistence and PostgreSQL guards

**Files:**

- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260823230000_phase13_packaging_transactions/migration.sql`
- Create: `prisma/migrations/20260823231000_phase13_packaging_integrity_guards/migration.sql`

**Interfaces:**

- Produces: transaction material class, DAMAGE operation/reason, packaging requirement provenance, packaging movement types, and class-aware number sequences.

- [ ] Add explicit material class, packaging damage reasons, packaging requirement line relation, and PI/PR/PC/PD-capable sequences while backfilling Phase 12 rows as RAW_MATERIAL.
- [ ] Add PACKAGING_ISSUE, PACKAGING_RETURN, PACKAGING_CONSUMPTION, and PACKAGING_DAMAGE movement support without changing existing raw movement semantics.
- [ ] Enforce exactly one matching requirement kind, IN_PROGRESS packaging batch eligibility, active PACKAGING_MATERIAL/item/unit/warehouse/lot provenance, damage reason rules, complete posted movement sets, and immutable posted data.
- [ ] Validate/generate Prisma and deploy the migrations to the configured development database.

### Task 2: Central posting and exact packaging reconciliation

**Files:**

- Modify: `src/modules/inventory/domain/inventory.ts`
- Modify: `src/server/inventory/transactional-inventory-posting.ts`
- Create: `src/modules/production/domain/packaging-reconciliation.ts`
- Create: `src/modules/production/application/packaging-contracts.ts`
- Create: `src/modules/production/application/manage-packaging-transactions.ts`

**Interfaces:**

- Produces: class-aware central posting for ISSUE/RETURN/CONSUMPTION/DAMAGE, packaging repository port, authenticated mutations, and exact reconciliation.

- [ ] Reuse the central posting function for packaging AVAILABLE-to-IN_PRODUCTION issue, inverse return, negative good consumption, and atomic IN_PRODUCTION-to-DAMAGED transfer.
- [ ] Recheck exact AVAILABLE or batch-held lot balance inside Serializable posting and reject negative custody.
- [ ] Normalize compatible units and reject fractional COUNT results; require a controlled reason for DAMAGE.
- [ ] Derive held = issued - returned - good consumed - damaged, total depleted = good consumed + damaged, provisional variance = total depleted - standard, and good-consumption variance = good consumed - standard.

### Task 3: Packaging transaction repository and lifecycle

**Files:**

- Create: `src/server/production/prisma-production-packaging-repository.ts`

**Interfaces:**

- Implements: `ProductionPackagingRepository`.
- Consumes: frozen packaging requirements and the central production inventory writer.
- Produces: PI/PR/PC/PD draft lifecycle, lot options, reconciliation, and history.

- [ ] Create and edit only PACKAGING_MATERIAL DRAFT rows with one frozen packaging requirement and generate class-specific numbers in Serializable transactions.
- [ ] Restrict all operations to IN_PROGRESS batches and the batch packaging warehouse; allow multiple issues and lots without overwriting history.
- [ ] Post inventory effects and header actor/time atomically; cancel only unposted drafts.
- [ ] Derive per-requirement availability, issued, returned, good-consumed, damaged, held, both variances, eligible AVAILABLE lots, batch-held lots, and filtered transaction history.

### Task 4: Protected packaging UI and batch integration

**Files:**

- Create: `src/components/production/packaging-transaction-form.tsx`
- Create: `src/app/(erp)/production/batches/[id]/packaging/actions.ts`
- Create: `src/app/(erp)/production/batches/[id]/packaging/page.tsx`
- Create: `src/app/(erp)/production/batches/[id]/packaging/[transactionId]/edit/page.tsx`
- Modify: `src/app/(erp)/production/batches/[id]/page.tsx`

**Interfaces:**

- Produces: production.view packaging reconciliation/history and production.manage issue/return/consumption/damage forms and lifecycle actions.

- [ ] Display BOM basis, standard, allowance, recommended, available, issued, returned, good consumed, damaged, held, total depleted, provisional variance, and good-consumption variance.
- [ ] Show only eligible AVAILABLE lots for ISSUE and batch-held lots for RETURN/CONSUMPTION/DAMAGE, including supplier/GRN/expiry/balance details.
- [ ] Require damage reason, show over-plan warning, and preserve DRAFT no-stock semantics with POST/CANCEL controls.
- [ ] Link the packaging workspace and concise raw/packaging actual summaries from batch detail without showing finished output.

### Task 5: Documentation and permitted verification

**Files:**

- Modify: `docs/phases/current.md`
- Modify: `docs/architecture/data-integrity.md`
- Modify: `docs/product/domain-glossary.md`
- Modify: `progress.md`

**Interfaces:**

- Produces: authoritative Phase 13 rules and verification evidence.

- [ ] Document packaging custody, good consumption, damage classification, reconciliation, provisional variance, routes, migrations, and Phase 14 boundary.
- [ ] Run only formatting, Prisma validate/generate/deploy/status, typecheck, lint, production build, live database connectivity, focused exact-calculation execution, and static authority/RBAC/scope scans.
- [ ] Mark Phase 13 complete only after all permitted gates pass and no known blocker prevents Phase 14.

## Unresolved Product Decisions

None. Out-of-plan packaging is omitted because the prompt permits but does not require it, and no controlled exception workflow exists in the completed architecture.
