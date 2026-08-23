# Phase 4 Master Data Foundation Implementation Plan

> **For agentic workers:** Use the host's available task-by-task implementation workflow. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement database-backed Units, Item Categories, Raw Materials, Packaging Materials, and Finished Goods without introducing inventory quantities or transactions.

**Architecture:** A new `master-data` module owns code normalization, item/category/unit contracts, validation, and use cases. A Prisma repository implements paginated reads and transactional writes; App Router pages and server actions enforce existing `inventory.view`/`inventory.manage` permissions. One unified `Item` table uses database constraints and composite foreign keys to enforce type-specific integrity.

**Tech Stack:** TypeScript 6, Next.js 16 App Router, React 19, Prisma 7.9.1, PostgreSQL 16/18-compatible SQL, Zod 4, Tailwind CSS 4.

## Global Constraints

- Preserve completed Phase 1–3 behavior and RBAC architecture.
- Do not add stock, ledger, movement, conversion, carton calculation, purchasing, production, sales, accounting, or other future-phase behavior.
- Store finished-good net content as PostgreSQL exact decimal and expose it to TypeScript as a decimal string.
- Create/update/activate/deactivate only; no destructive master-data deletion.
- Search by code/name through server-side pagination with a fixed page size.
- Do not create or run automated tests in Phase 4, per the explicit phase brief.
- Verification is limited to Prisma validation/generation, migration/seed, format, lint, typecheck, route inspection, production build, and safe database observations.
- Do not commit because this repository has no baseline commit.

---

### Task 1: Define master-data schema, constraints, migration, and seeds

**Files:**

- Modify: `prisma/schema.prisma`, `prisma.config.ts`, `package.json`
- Create: `prisma/migrations/20260823113655_phase4_master_data/migration.sql`
- Create: `src/modules/master-data/domain/master-data.ts`
- Create: `src/modules/master-data/application/seed-master-data.ts`
- Create: `scripts/seed-master-data.ts`, `scripts/seed-all.ts`

**Interfaces:**

- Produces enums `ItemType`, `UnitDimension`, and `PackagingKind` in Prisma and matching TypeScript literal registries.
- Produces models `Unit`, `ItemCategory`, `Item`, and `FinishedGoodProfile`.
- Produces `normalizeMasterCode(value)` using trim, uppercase, whitespace/underscore-to-hyphen normalization and validation against `A-Z`, digits, and internal hyphens.
- Produces `seedMasterData(store)` for five standard units and a small type-specific default-category set.

- [ ] Add schema models, indexes for type/status/name listing, exact `Decimal(18,6)` net content, and restrictive foreign keys.
- [ ] Enforce category/item type through a composite foreign key; enforce packaging kind and finished-good-only profile rules through migration check constraints.
- [ ] Enforce MASS/VOLUME net-content units through a composite unit/dimension foreign key plus a dimension check.
- [ ] Generate and review the checked-in migration without stock columns.
- [ ] Implement idempotent unit/category seeds and configure a combined Prisma seed entry point.
- [ ] Run Prisma validate/generate and migration diff generation; expect exit 0 without running tests.

### Task 2: Implement module contracts, validation, and Prisma repository

**Files:**

- Create: `src/modules/master-data/application/contracts.ts`
- Create: `src/modules/master-data/application/manage-units.ts`
- Create: `src/modules/master-data/application/manage-categories.ts`
- Create: `src/modules/master-data/application/manage-items.ts`
- Create: `src/server/master-data/prisma-master-data-repository.ts`

**Interfaces:**

- Produces paginated list contracts `{ records, page, pageSize, total, pageCount }` with code/name search.
- Produces unit/category/item create, update, and status use cases accepting an `ApplicationPrincipal` and repository port.
- Item writes accept discriminated inputs for raw material, packaging material with `packagingKind`, and finished good with decimal-string `netContentQuantity`, MASS/VOLUME unit, and positive integer `piecesPerCarton`.

- [ ] Implement Zod schemas and pure normalization at application boundaries.
- [ ] Require `inventory.view` for reads through page guards and `inventory.manage` for all use-case mutations.
- [ ] Validate referenced unit/category activity and type; validate finished-good unit dimension and exact positive decimal syntax without JavaScript number arithmetic.
- [ ] Implement Prisma pagination, case-insensitive search, unique-conflict handling, and transactions for item/profile writes.
- [ ] Preserve inactive records and expose no delete method.
- [ ] Run strict TypeScript and ESLint; expect exit 0 without running tests.

### Task 3: Build Units and Categories screens

**Files:**

- Create: `src/app/(erp)/inventory/units/page.tsx`, `actions.ts`
- Create: `src/app/(erp)/inventory/categories/page.tsx`, `actions.ts`
- Create: `src/components/master-data/unit-form.tsx`
- Create: `src/components/master-data/category-form.tsx`
- Create: `src/components/master-data/master-status-form.tsx`
- Create: `src/components/master-data/search-pagination.tsx`

**Interfaces:**

- Pages consume `searchParams.q` and `searchParams.page`, render at most 25 rows, and call `requirePermission("inventory.view")`.
- Server actions validate `FormData`, call use cases that repeat `inventory.manage`, revalidate their route, and return safe action state.

- [ ] Implement responsive create/edit forms with pending feedback and active/inactive controls.
- [ ] Render server-backed searchable, paginated unit and category tables.
- [ ] Hide mutation controls when the principal lacks `inventory.manage` while retaining server enforcement.
- [ ] Run format, typecheck, lint, and production route build checks without tests.

### Task 4: Build unified item screens for all three item types

**Files:**

- Create: `src/app/(erp)/inventory/raw-materials/page.tsx`, `actions.ts`
- Create: `src/app/(erp)/inventory/packaging-materials/page.tsx`, `actions.ts`
- Create: `src/app/(erp)/inventory/finished-goods/page.tsx`, `actions.ts`
- Create: `src/components/master-data/item-form.tsx`
- Create: `src/components/master-data/item-list.tsx`
- Create: `src/components/master-data/item-status-form.tsx`

**Interfaces:**

- A shared discriminated item form renders only packaging-kind or finished-good profile fields appropriate to the route's fixed item type.
- Item actions ignore client attempts to change the route-owned item type and call transactional use cases.

- [ ] Implement searchable paginated raw-material, packaging-material, and finished-good lists.
- [ ] Implement create/edit/activate/deactivate with active type-compatible category/unit options.
- [ ] Render exact net-content strings and pieces-per-carton without stock or conversion calculations.
- [ ] Apply `inventory.view` page guards and repeated `inventory.manage` mutation authorization.
- [ ] Run format, typecheck, lint, and production route build checks without tests.

### Task 5: Activate navigation and apply the live database change

**Files:**

- Modify: `src/config/navigation.ts`
- Modify: `src/app/(erp)/inventory/page.tsx`

**Interfaces:**

- Produces active Inventory children for Units, Categories, Raw Materials, Packaging Materials, and Finished Goods, each requiring `inventory.view`.

- [ ] Add `/inventory/units` and `/inventory/categories` to route constants and activate all five Phase 4 links.
- [ ] Replace the Inventory placeholder with a guarded master-data landing page linking to the five live screens.
- [ ] Apply the migration to development PostgreSQL and run the combined seed twice.
- [ ] Observe counts/constraints safely and confirm no stock columns or records exist.

### Task 6: Document and verify Phase 4

**Files:**

- Modify: `docs/phases/current.md`
- Modify: `docs/product/domain-glossary.md`
- Modify: `README.md` only if setup/seed commands changed

**Interfaces:**

- Documentation records only demonstrated Phase 4 behavior, migration, seeds, limitations, and Phase 5 readiness.

- [ ] Run Prettier check, ESLint, Prisma validate/generate, strict TypeScript, production build, migration status, seed, and database connectivity; do not invoke Vitest or any automated test suite.
- [ ] Inspect routes/actions for page and mutation permission guards, pagination, absence of delete operations, and absence of stock/conversion/transaction fields.
- [ ] Update authoritative phase/domain documentation after evidence is final.
- [ ] Obtain an independent read-only completion audit and stop before Phase 5.

## Unresolved product decisions

None. Codes use the explicit normalization contract above; pages use 25-row server pagination; default categories remain editable/inactivatable masters rather than immutable system records.
