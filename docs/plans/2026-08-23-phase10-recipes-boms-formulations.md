# Phase 10 Recipes, BOMs & Product Formulations Implementation Plan

> **For agentic workers:** Use the host's available task-by-task implementation workflow. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add versioned, approvable recipe/formulation master data with exact recipe scaling and packaging BOM requirement calculations, without creating production or inventory transactions.

**Architecture:** A production-owned Recipe aggregate stores one immutable formula version, its ingredient lines, and a one-to-one Packaging BOM. Application use cases enforce `production.manage`; a Prisma repository owns active-master validation, exact normalization, version creation, approval/default-version transitions, and pagination. Pure Decimal.js domain operations calculate scaled ingredients, expected yield, and per-piece/per-carton packaging requirements for future production consumers.

**Tech Stack:** TypeScript 6, Next.js 16 App Router/server actions, Prisma 7, PostgreSQL, Decimal.js, Zod, React 19, Tailwind CSS.

## Global Constraints

- Work in the current session/workspace only; no agents, subagents, delegation, or orchestration.
- Do not create or run automated tests, existing test suites, or aggregate verification commands that execute tests.
- Preserve completed Phase 1–9 behavior, RBAC, exact quantity rules, and the inventory ledger authority.
- Recipe operations are manufacturing master data only and must create zero inventory movements, production orders/batches, reservations, WIP, consumption, output, waste, costing, or accounting effects.
- Use active master references for new/approval operations, exact decimal arithmetic, supported Phase 5 units, server-resolved actor identity, restrictive foreign keys, and database lifecycle guards.

---

### Task 1: Persist versioned recipes, ingredients, and Packaging BOMs

**Files:**

- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260823200000_phase10_recipes_boms/migration.sql`
- Create: `prisma/migrations/20260823201000_phase10_recipe_integrity_guards/migration.sql`

**Interfaces:**

- Produces `Recipe`, `RecipeIngredient`, `PackagingBom`, and `PackagingBomLine` models with `RecipeStatus` and `PackagingUsageBasis` enums.
- Connects recipes to existing finished goods, units, raw materials, packaging materials, and authenticated users without duplicating master data.

- [x] Store stable recipe code plus integer version under a composite unique key, exact entered/normalized batch and optional output quantities, actors/timestamps/effective date, exact line quantities, allowances, sequence, and notes.
- [x] Add restrictive relations, positive/uniqueness checks, one BOM per recipe, one ingredient item per version, and one packaging item/basis combination per version.
- [x] Add PostgreSQL guards that reject non-finished-good recipe headers, non-raw ingredients, non-packaging BOM materials, incompatible entered/canonical units, non-DRAFT formula mutations, invalid lifecycle transitions, and more than one APPROVED recipe per finished good.
- [x] Run `corepack pnpm exec prisma format`, `corepack pnpm db:validate`, and `corepack pnpm db:generate`; expect a valid schema and generated client.

### Task 2: Implement exact recipe and packaging calculations

**Files:**

- Create: `src/modules/production/domain/recipe-calculations.ts`
- Create: `src/modules/production/application/contracts.ts`

**Interfaces:**

- Produces `scaleRecipe(recipe, target, units)` returning target normalization, scale factor, scaled net ingredient quantities, and allowance-separated planned issue quantities.
- Produces `calculatePackagingRequirements(recipe, cartons, loosePieces)` returning normalized cartons/pieces, standard requirements, and allowance-adjusted issue quantities.
- Produces `calculateExpectedYield(recipe)` only when standard batch and expected output dimensions match.

- [x] Use Decimal.js and existing Phase 5 normalization/carton primitives; reject cross-dimension batch scaling and nonpositive inputs.
- [x] Multiply PER_PIECE lines by all planned pieces and PER_CARTON lines by normalized whole cartons only; loose pieces do not allocate an extra carton.
- [x] Round allowance-adjusted COUNT packaging requirements upward to whole pieces while retaining separate standard and recommended quantities.
- [x] Run `corepack pnpm typecheck`; expect the reusable domain contract to compile without inventory dependencies.

### Task 3: Implement recipe application use cases and repository

**Files:**

- Create: `src/modules/production/application/manage-recipes.ts`
- Create: `src/modules/production/application/recipe-listing.ts`
- Create: `src/server/production/prisma-recipe-repository.ts`

**Interfaces:**

- Produces recipe catalog queries, DRAFT create/update, approval, inactivation, new-version cloning, paginated history, detail, scale, and packaging-calculation operations.
- Consumes authenticated `ApplicationPrincipal`, Phase 5 quantity normalization, and Task 2 calculation functions.

- [x] Parse practical multi-line forms with Zod and enforce `production.manage` in every mutation use case.
- [x] Normalize the standard batch/output/ingredient/BOM quantities server-side; validate active finished good, raw materials, packaging materials, compatible units, positive quantities, distinct ingredients, and distinct packaging item/basis pairs.
- [x] Save and replace only DRAFT aggregate lines atomically in Serializable transactions; never write `InventoryMovement`.
- [x] Approve only a fully revalidated DRAFT, record server actor/time, and atomically inactivate the prior APPROVED recipe for that finished good before making the selected version the sole default.
- [x] Clone any historical version into `max(version)+1` DRAFT with copied formulation/BOM/notes, null approval/effective metadata, and an unchanged recipe code.
- [x] Run `corepack pnpm typecheck` and `corepack pnpm lint`; expect clean production boundaries.

### Task 4: Deliver Recipe list, form, detail, lifecycle, and calculators

**Files:**

- Create: `src/components/production/action-state.ts`
- Create: `src/components/production/recipe-form.tsx`
- Create: `src/components/production/recipe-actions.tsx`
- Create: `src/components/production/recipe-calculators.tsx`
- Create: `src/app/(erp)/production/recipes/actions.ts`
- Create: `src/app/(erp)/production/recipes/page.tsx`
- Create: `src/app/(erp)/production/recipes/new/page.tsx`
- Create: `src/app/(erp)/production/recipes/[id]/page.tsx`
- Create: `src/app/(erp)/production/recipes/[id]/edit/page.tsx`

**Interfaces:**

- Consumes Task 3 repository records/use cases through server actions guarded by `production.manage`; pages use `production.view`.

- [x] Add server-paginated recipe code/product search and status/version/finished-good filters with history links.
- [x] Add a practical DRAFT form for batch/output basis, ingredient lines, packaging BOM lines, allowances, sequences, notes, and effective date.
- [x] Add DRAFT edit/approve, APPROVED inactivate, and historical Create New Version actions with status-aware visibility.
- [x] Show the required header, ingredient, packaging, metadata, yield, and history sections on detail.
- [x] Add reusable server-backed scaling and packaging requirement calculators showing standard versus allowance-adjusted quantities.
- [x] Run `corepack pnpm typecheck`, `corepack pnpm lint`, and `corepack pnpm build`; expect all recipe routes to compile.

### Task 5: Integrate Production navigation and Finished Goods

**Files:**

- Modify: `src/config/navigation.ts`
- Modify: `src/app/(erp)/production/page.tsx`
- Modify: `src/components/master-data/item-list.tsx`

**Interfaces:**

- Activates `/production/recipes` under `production.view` and links each finished good to its filtered recipe history without copying recipe data.

- [x] Replace the Production placeholder with a recipe entry point while leaving later production features planned.
- [x] Add finished-good Recipe History links filtered by finished-good ID; recipe list/detail identifies the current approved version and all historical versions.
- [x] Confirm recipe actions require `production.manage`, recipe pages require `production.view`, and no RBAC architecture changes were introduced.

### Task 6: Apply migrations, verify scope, and document Phase 10

**Files:**

- Modify: `docs/phases/current.md`
- Modify: `docs/architecture/data-integrity.md`
- Modify: `docs/product/domain-glossary.md`
- Modify: `progress.md`

**Interfaces:**

- Produces the authoritative Phase 10 handoff and implementation evidence.

- [x] Apply both migrations with `corepack pnpm exec prisma migrate deploy`; expect the configured development PostgreSQL database to reach the current schema.
- [x] Inspect production code and database changes to confirm recipe operations contain no inventory movement, production transaction, costing, purchasing, or accounting writes.
- [x] Run only `corepack pnpm format`, `corepack pnpm format:check`, `corepack pnpm db:validate`, `corepack pnpm db:generate`, `corepack pnpm typecheck`, `corepack pnpm lint`, `corepack pnpm build`, `corepack pnpm exec prisma migrate status`, and `corepack pnpm db:check`; expect PASS without invoking tests.
- [x] Update current-phase and authoritative domain documentation only after implementation gates pass, then rerun formatting and affected non-test gates.

## Externally Observable Decisions

- Recipe code is stable across its versions and unique together with version; new-version creation uses the next version number for that code.
- Only one APPROVED/default recipe may exist per finished good. Approving another version atomically changes the previous approved version to INACTIVE; historical records remain readable.
- Expected output is optional. Expected yield is displayed only when output and standard-batch dimensions match; no MASS-to-VOLUME density assumption is made.
- Effective date is user-supplied and optional. New-version creation clears it along with approval metadata while copying formulation, BOM, allowances, and notes.
- Ingredient and packaging allowances are nonnegative percentages stored separately from standard quantities; they never overwrite the formula/BOM quantity.
- PER_CARTON requirements use normalized whole cartons after loose-piece overflow; remaining loose pieces consume only PER_PIECE materials.
- Automated tests are intentionally absent and unrun by explicit user instruction.
