# Phase 6 Warehouses and Inventory Ledger Implementation Plan

> **For agentic workers:** Use the host's available task-by-task implementation workflow. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement warehouse masters and an immutable signed-canonical inventory ledger with ledger-derived stock, controlled manual posting, atomic transfers, history, and overview screens.

**Architecture:** The inventory module owns statuses, movement contracts, posting validation, and authorization. A single Prisma inventory repository is the only movement writer; it uses Serializable transactions with bounded retry for availability checks and atomic paired movements. UI routes invoke server actions/use cases and render ledger-derived read models; no balance table or editable stock field exists.

**Tech Stack:** TypeScript 6, Next.js 16 App Router, React 19, Prisma 7.9.1, PostgreSQL exact decimals, Zod 4, decimal.js, Tailwind CSS 4.

## Global Constraints

- Preserve Phase 1–5 architecture, RBAC, masters, and quantity rules.
- Store immutable signed canonical movements only; never store or edit current stock, cartons, or loose balances.
- All movement writers go through the inventory application/repository boundary and resolve the actor server-side.
- Reject insufficient source-bucket quantity immediately before posting inside a Serializable transaction.
- Warehouse and status paired movements commit atomically and share a group/reference.
- Do not implement costing, purchasing, production, sales, reports, or other Phase 7+ workflows.
- Do not create or run automated tests and do not use agents/subagents, per the explicit brief.
- Do not commit because the repository has no baseline commit.

---

### Task 1: Add ledger schema and migration

**Files:** Modify `prisma/schema.prisma`; create the generated Phase 6 migration.

- [x] Add controlled inventory status and movement-type enums, Warehouse, and immutable InventoryMovement models.
- [x] Store signed `Decimal(24,6)` canonical quantity, canonical unit, actor, time, source/reference/group, and reason.
- [x] Add restrictive foreign keys, query indexes, nonzero/sign check constraints, and no balance model/field.
- [x] Validate/generate Prisma and create/apply the development migration without tests.

### Task 2: Implement inventory contracts and the sole Prisma writer

**Files:** Create `src/modules/inventory/domain/inventory.ts`, `src/modules/inventory/application/contracts.ts`, `posting.ts`, `listing.ts`, and `src/server/inventory/prisma-inventory-repository.ts`.

- [x] Normalize unit or finished-good carton inputs through Phase 5 utilities and validate Zod boundaries.
- [x] Implement opening, adjustment-in/out, warehouse transfer, and reusable status transfer operations.
- [x] Revalidate active item/warehouse/unit references and sufficient source-bucket stock inside Serializable retry transactions.
- [x] Implement ledger SUM queries for bucket, AVAILABLE, total physical, overview, and paginated filtered history.
- [x] Expose no update/delete movement method.

### Task 3: Implement warehouse master

**Files:** Create `src/app/(erp)/inventory/warehouses/page.tsx`, `actions.ts`, and focused warehouse form/status components.

- [x] Require `inventory.view` for the searchable paginated list and `inventory.manage` for create/edit/status actions.
- [x] Normalize unique codes, preserve referenced warehouses, and block destructive deletion.
- [x] Prevent deactivation while active inventory remains or active posting dependencies require the warehouse.

### Task 4: Implement posting and history screens

**Files:** Create `src/app/(erp)/inventory/stock-adjustments/page.tsx`, `actions.ts`, `src/app/(erp)/inventory/stock-movements/page.tsx`, and inventory form/list components.

- [x] Provide opening, adjustment in/out, and atomic warehouse-transfer forms using server-resolved identity.
- [x] Support canonical quantity input and cartons/loose for finished goods; require reason/reference.
- [x] Render immutable movement history with server pagination and item/warehouse/type/status/date filters.
- [x] Return safe insufficient-stock, invalid-reference, duplicate-source, and validation errors.

### Task 5: Implement ledger-derived overview and navigation

**Files:** Create `src/app/(erp)/inventory/stock-overview/page.tsx`; modify `src/config/navigation.ts` and `src/app/(erp)/inventory/page.tsx`.

- [x] Aggregate item/warehouse AVAILABLE, other-status, and total physical quantities from movement SUM only.
- [x] Format raw/packaging quantities with Phase 5 unit formatting and finished goods as PCS plus cartons/loose.
- [x] Activate Warehouses, Stock Overview, Stock Movements, and Stock Adjustments navigation with `inventory.view`.

### Task 6: Document and verify Phase 6

**Files:** Modify `docs/phases/current.md`, `docs/product/domain-glossary.md`, `docs/architecture/data-integrity.md`, `README.md`, and `progress.md`.

- [x] Apply migration and inspect constraints/indexes and absence of editable balance fields.
- [x] Run only Prettier, ESLint, Prisma validate/generate, TypeScript, production build, migration status, seed/connectivity, and safe database observations.
- [x] Inspect server guards, single writer, transaction boundaries, negative-stock checks, immutable history, and route integration.
- [x] Update documentation after evidence is current and stop before Phase 7.

## Unresolved product decisions

None. Movements use signed canonical quantity; all source buckets are protected from going negative, which includes and strengthens the required AVAILABLE rule. Opening/reference source keys are optional but unique per movement type when supplied, preparing future idempotency without implementing a broader event system.
