# Phase 12 Raw Material Issue, Return & Consumption Implementation Plan

> **For agentic workers:** Use the host's available task-by-task implementation workflow. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move released-batch raw materials from AVAILABLE into lot-specific IN_PRODUCTION custody, then return or consume them with exact reconciliation and no packaging, finished-goods, costing, or accounting effects.

**Architecture:** Extend the production module with DRAFT/POSTED/CANCELLED material transactions and single or multi-line lot-level detail. All physical posting goes through a production-specific function in the central transactional inventory authority, which writes immutable canonical ledger movements with batch and transaction-line provenance inside the same Serializable transaction that posts the production transaction and starts the batch. Read models derive issued, returned, consumed, held, and variance quantities from posted ledger-backed transactions rather than editable totals.

**Tech Stack:** TypeScript, Next.js App Router, React server actions, Zod, Decimal.js, Prisma 7, PostgreSQL, Tailwind CSS.

## Global Constraints

- Work inline in the current workspace without agents, delegation, or orchestration.
- Do not create or run automated tests or aggregate commands that execute tests.
- Add IN_PRODUCTION as physical batch custody, not monetary WIP.
- Handle RAW_MATERIAL items only; do not issue or consume packaging.
- Preserve supplier InventoryLot identity through issue, return, and consumption.
- Use the batch raw-material warehouse as both the normal store and same-location IN_PRODUCTION custody because Phase 11 has no separate production-floor warehouse.
- Generate authoritative MI/MR/MC numbers server-side; UUID remains the primary key.
- DRAFT transactions have no stock effect; POSTED transactions and ledger rows are immutable; only DRAFT may be cancelled normally.
- First posted ISSUE changes RELEASED to IN_PROGRESS atomically; batches with physical movement cannot be normally cancelled.
- Use exact canonical quantities and reject insufficient lot-level AVAILABLE or batch-specific IN_PRODUCTION custody inside the posting transaction.
- Enforce `production.view` for reads and `production.manage` for transaction creation, editing, posting, and cancellation.
- Create no packaging movements, finished-goods output, production lots, WIP value, costing, journals, or accounting entries.

---

### Task 1: Material transaction persistence and PostgreSQL safeguards

**Files:**

- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260823220000_phase12_production_material_flow/migration.sql`
- Create: `prisma/migrations/20260823221000_phase12_material_integrity_guards/migration.sql`

**Interfaces:**

- Produces: IN_PRODUCTION inventory status, PRODUCTION_CONSUMPTION movement type, production transaction/header/line/sequence models, and relational production provenance on InventoryMovement.

- [ ] Add ISSUE/RETURN/CONSUMPTION and DRAFT/POSTED/CANCELLED enums, exact line quantities, lot/requirement/warehouse/unit references, actor timestamps, and MI/MR/MC sequence rows.
- [ ] Add `productionBatchId` and `productionMaterialTransactionLineId` to ledger movements so batch custody is independently queryable without changing ledger authority.
- [ ] Add positive/type/provenance constraints and indexes; preserve supplier-lot and raw-material composite foreign keys.
- [ ] Add database guards for valid transaction lifecycles, DRAFT-only editing, immutable posted headers/lines, complete posted movement provenance, and RELEASED -> IN_PROGRESS batch transition.
- [ ] Validate/generate Prisma and deploy both migrations to the configured development database.

### Task 2: Central inventory posting and production material contracts

**Files:**

- Modify: `src/modules/inventory/domain/inventory.ts`
- Modify: `src/server/inventory/transactional-inventory-posting.ts`
- Create: `src/modules/production/application/material-contracts.ts`
- Create: `src/modules/production/application/manage-material-transactions.ts`
- Create: `src/modules/production/domain/material-reconciliation.ts`

**Interfaces:**

- Produces: `postProductionMaterialInventory(transaction, command)`, material transaction repository port, Zod mutation use cases, and exact reconciliation/variance helpers.

- [ ] Extend central inventory types for IN_PRODUCTION and PRODUCTION_CONSUMPTION without exposing manual generic production posting.
- [ ] For ISSUE, atomically write AVAILABLE negative plus IN_PRODUCTION positive movements for the same item/lot/batch/line after immediate lot-level sufficiency checks.
- [ ] For RETURN, atomically write batch IN_PRODUCTION negative plus destination AVAILABLE positive movements; for CONSUMPTION, write only batch IN_PRODUCTION negative.
- [ ] Validate active RAW_MATERIAL item, active warehouse/unit, matching lot/item, canonical unit, positive quantity, and batch-specific custody before every physical write.
- [ ] Define exact issued-returned-consumed-held reconciliation and consumed-minus-planned variance with over/under/exact labels.

### Task 3: Prisma material transaction repository and lifecycle

**Files:**

- Create: `src/server/production/prisma-production-material-repository.ts`

**Interfaces:**

- Implements: `ProductionMaterialRepository`.
- Consumes: Phase 11 requirement snapshots and `postProductionMaterialInventory`.
- Produces: draft CRUD, post/cancel commands, eligible AVAILABLE/batch-held lot options, requirement reconciliation, and transaction history.

- [ ] Generate MI/MR/MC numbers by type/year in Serializable transactions and create/edit only DRAFT transactions.
- [ ] Restrict issue lines to the batch requirement and source warehouse; restrict return/consumption to lot quantities currently held by that batch.
- [ ] Post transaction header, inventory movements, actor/time, and first-issue IN_PROGRESS transition atomically.
- [ ] Derive cumulative issue, return, consumption, current custody, variance, lot availability, and history from posted transactions/ledger data.
- [ ] Cancel only unposted drafts and preserve all posted records.

### Task 4: Batch materials UI and protected actions

**Files:**

- Create: `src/components/production/material-transaction-form.tsx`
- Create: `src/components/production/material-transaction-actions.tsx`
- Create: `src/app/(erp)/production/batches/[id]/materials/actions.ts`
- Create: `src/app/(erp)/production/batches/[id]/materials/page.tsx`
- Create: `src/app/(erp)/production/batches/[id]/materials/[transactionId]/edit/page.tsx`
- Modify: `src/app/(erp)/production/batches/[id]/page.tsx`

**Interfaces:**

- Consumes: repository batch-material view, eligible lots, units, warehouses, mutation use cases.
- Produces: requirement reconciliation table, lot-aware ISSUE/RETURN/CONSUMPTION draft forms, POST/CANCEL actions, and transaction history.

- [ ] Show planned, allowance, recommended, available, issued, returned, consumed, held, and quantity variance for every raw-material requirement.
- [ ] Present eligible AVAILABLE supplier lots for ISSUE and only batch-held lots for RETURN/CONSUMPTION, including lot/reference/date/availability details.
- [ ] Save/edit DRAFT transactions without stock effect; expose POST/CANCEL only when status and `production.manage` permit.
- [ ] Show transaction and lot history while keeping the Inventory Ledger authoritative; add the materials link to eligible batch detail pages.

### Task 5: Documentation and permitted verification

**Files:**

- Modify: `docs/phases/current.md`
- Modify: `docs/architecture/data-integrity.md`
- Modify: `docs/product/domain-glossary.md`
- Modify: `progress.md`

**Interfaces:**

- Produces: authoritative Phase 12 custody, reconciliation, traceability, routes, migrations, and Phase 13 boundary documentation.

- [ ] Document IN_PRODUCTION, material transactions, lot-preserving issue/return/consumption, reconciliation, first-issue batch start, and no-costing/no-packaging boundaries.
- [ ] Run only format/check, Prisma validate/generate/deploy/status, typecheck, lint, production build, live database connectivity, focused exact-calculation/manual database checks, and static RBAC/scope scans.
- [ ] Mark Phase 12 complete only after all permitted non-test gates pass and no known blocker prevents Phase 13.

## Unresolved Product Decisions

None. The supplied contract explicitly permits same-warehouse status transfer where no separate production-floor warehouse exists; Phase 11 provides no production-floor field.
