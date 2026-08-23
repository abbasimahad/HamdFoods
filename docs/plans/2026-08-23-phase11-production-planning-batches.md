# Phase 11 Production Planning & Batch Creation Implementation Plan

> **For agentic workers:** Use the host's available task-by-task implementation workflow. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build controlled production plans from approved recipe versions through DRAFT, PLANNED, RELEASED, and eligible CANCELLED states without changing inventory or accounting.

**Architecture:** Extend the production module with exact, persisted batch and requirement snapshots. Prisma owns durable lifecycle and immutability constraints; application use cases validate permissions and input; the production repository reuses the Phase 5 carton and Phase 10 scaling engines and reads AVAILABLE ledger balances without posting movements. Next.js server pages/actions expose permission-protected list, create, edit, detail, plan, release, and cancel workflows.

**Tech Stack:** TypeScript, Next.js App Router, React server actions, Zod, Decimal.js, Prisma 7, PostgreSQL, Tailwind CSS.

## Global Constraints

- Work inline in the current workspace without agents, delegation, or orchestration.
- Do not create or run automated tests or aggregate commands that execute tests.
- Use only approved active recipe versions for new plans and preserve the exact recipe ID/version.
- Use exact decimal arithmetic and existing quantity, carton, recipe-scaling, and Packaging BOM contracts.
- Persist raw-material and packaging requirement snapshots; PLANNED and RELEASED core plans are immutable.
- Availability is an informational, server-derived AVAILABLE ledger sum for the selected source warehouse.
- Release with shortages requires explicit acknowledgement; no approval hierarchy is added.
- Create no inventory movements, reservations, material issues, WIP, output receipts, costing, journals, or accounting effects.
- Enforce `production.view` for reads and `production.manage` for all mutations, resolving actors server-side.

---

### Task 1: Production batch persistence and database guards

**Files:**

- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260823210000_phase11_production_batches/migration.sql`
- Create: `prisma/migrations/20260823211000_phase11_batch_integrity_guards/migration.sql`

**Interfaces:**

- Produces: `ProductionBatch`, `ProductionMaterialRequirement`, `ProductionPackagingRequirement`, `ProductionBatchSequence`, and `ProductionBatchStatus` Prisma contracts.

- [x] Add exact batch-basis, expected-output, packaged-output, warehouse, actor, lifecycle, and snapshot columns with restrictive relations and useful indexes.
- [x] Generate unique readable numbers from a PostgreSQL year sequence while retaining UUID primary keys.
- [x] Add positive/nonnegative/check constraints, exact recipe/finished-good consistency, allowed lifecycle transitions, and PostgreSQL immutability guards for PLANNED/RELEASED/CANCELLED core data and snapshots.
- [x] Validate and generate Prisma client; apply migrations to the configured development PostgreSQL database.

### Task 2: Batch calculations and application contracts

**Files:**

- Create: `src/modules/production/domain/batch-calculations.ts`
- Create: `src/modules/production/application/batch-contracts.ts`
- Create: `src/modules/production/application/manage-batches.ts`
- Create: `src/modules/production/application/batch-listing.ts`

**Interfaces:**

- Consumes: `scaleRecipe`, `calculatePackagingRequirements`, `normalizeQuantity`, and `normalizeCartonQuantity`.
- Produces: batch input/result records, output-content reconciliation, lifecycle commands, repository port, and list-filter parsing.

- [x] Define exact batch, material snapshot, packaging snapshot, warehouse, recipe-option, availability, and pagination contracts.
- [x] Calculate scale factor, planned raw-material quantities, allowance-adjusted recommendations, expected output, cartons/loose/total pieces, product content, and signed difference using Decimal.js.
- [x] Parse and validate DRAFT saves, plan, release acknowledgement, and cancellation reason with Zod and server-authoritative `production.manage` checks.
- [x] Reject nonpositive/incompatible batch quantities, negative or fractional carton inputs, and invalid dates/references.

### Task 3: Prisma production-batch repository

**Files:**

- Create: `src/server/production/prisma-production-batch-repository.ts`

**Interfaces:**

- Implements: `ProductionBatchRepository`.
- Reads: approved recipe snapshots, active warehouses/units, finished-good profiles, and AVAILABLE inventory-ledger sums.
- Writes: production batch headers and requirement snapshots only.

- [x] List eligible approved recipes, supported units, active warehouses, batches, and complete batch details.
- [x] Create/update only DRAFT batches in Serializable transactions, replacing snapshots atomically after server-side recalculation.
- [x] Plan only an eligible DRAFT after complete revalidation; release only PLANNED after current availability refresh and explicit shortage acknowledgement where required.
- [x] Cancel eligible DRAFT/PLANNED/RELEASED batches with actor, timestamp, and reason while preserving all history.
- [x] Confirm repository code never creates, updates, or deletes `InventoryMovement` or accounting records.

### Task 4: Production batch UI and server actions

**Files:**

- Create: `src/components/production/batch-form.tsx`
- Create: `src/components/production/batch-actions.tsx`
- Create: `src/app/(erp)/production/batches/actions.ts`
- Create: `src/app/(erp)/production/batches/page.tsx`
- Create: `src/app/(erp)/production/batches/new/page.tsx`
- Create: `src/app/(erp)/production/batches/[id]/page.tsx`
- Create: `src/app/(erp)/production/batches/[id]/edit/page.tsx`

**Interfaces:**

- Consumes: repository list/detail/catalog contracts and batch application use cases.
- Produces: server-paginated list/filter UI, practical DRAFT planning form, immutable detail views, and lifecycle actions.

- [x] Build list filters for batch/product/status/date/recipe with pagination and required summary columns.
- [x] Build a responsive DRAFT form for recipe, dates, three warehouses, planned batch quantity/unit, cartons, loose pieces, and notes.
- [x] Show production basis, output reconciliation, material/packaging snapshots, current availability, shortage/surplus, actors, and warehouses on detail.
- [x] Expose plan, shortage-aware release, cancel, and DRAFT edit actions only when lifecycle and `production.manage` permit; repeat permission enforcement in every server action.

### Task 5: Navigation, documentation, and implementation verification

**Files:**

- Modify: `src/app/(erp)/production/page.tsx`
- Modify: `src/config/navigation.ts`
- Modify: `docs/phases/current.md`
- Modify: `docs/architecture/data-integrity.md`
- Modify: `docs/product/domain-glossary.md`
- Modify: `progress.md`

**Interfaces:**

- Produces: discoverable batch routes and authoritative Phase 11 lifecycle/no-stock-effect documentation.

- [x] Add Production Batches navigation while preserving Recipes and excluding Phase 12 material issue.
- [x] Document exact recipe traceability, requirement snapshots, lifecycle, availability checks, shortage acknowledgement, and zero inventory/accounting effect.
- [x] Run only formatting, Prisma validation/generation/status, migration deploy, typecheck, lint, production build, live database check, and focused static scope scans.
- [x] Mark Phase 11 complete only after every non-test gate passes and no known blocker prevents Phase 12.

## Unresolved Product Decisions

None. The supplied Phase 11 contract settles observable behavior; the batch-level source warehouse design is the minimum architecture it explicitly permits.
