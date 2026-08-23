# Phase 5 Quantity, Conversion, and Carton Engine Implementation Plan

> **For agentic workers:** Use the host's available task-by-task implementation workflow. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Build reusable exact quantity, supported-unit conversion, carton/piece, finished-good content, rate, and display utilities, then expose them through the finished-goods UI and an authorized calculator page without introducing inventory state.

**Architecture:** A new `quantity` domain module owns all exact arithmetic and compatibility invariants using `decimal.js`, while an application boundary parses calculator input and consumes a narrow catalog port. A server-only Prisma adapter resolves active Unit and FinishedGoodProfile records; server-rendered inventory pages calculate derived values and React only renders results.

**Tech Stack:** TypeScript 6, Next.js 16 App Router, React 19, Prisma 7.9.1, PostgreSQL, Zod 4, decimal.js, Tailwind CSS 4.

## Global Constraints

- Preserve completed Phase 1â€“4 behavior and use the existing Unit and FinishedGoodProfile masters.
- Canonical bases are G for MASS, ML for VOLUME, and PCS for COUNT; supported codes are limited to KG, G, L, ML, and PCS.
- All authoritative quantity and rate arithmetic uses exact decimals or integers, never JavaScript floating point.
- Reject inactive, missing, unsupported, or dimension-incompatible units at the server boundary.
- Normalize loose pieces automatically; carton and piece counts are non-negative integers and pieces per carton is positive.
- Do not store calculated quantities, cartons, loose pieces, stock, prices, or calculator submissions.
- Do not add warehouses, inventory ledgers, movements, transactions, or any Phase 6+ module.
- Do not create or run automated tests in Phase 5, per the explicit phase brief. Verification is limited to format, lint, Prisma validation/generation, TypeScript, production build, safe route/domain inspection, and database connectivity.
- Do not commit because this repository has no baseline commit.

---

### Task 1: Implement exact quantity and unit conversion domain

**Files:**

- Modify: `package.json`, `pnpm-lock.yaml`
- Create: `src/modules/quantity/domain/quantity.ts`

**Interfaces:**

- Consumes unit descriptors `{ code, symbol, dimension, active }` resolved from Phase 4 masters.
- Produces `normalizeQuantity`, `convertQuantity`, `compareQuantities`, `addQuantities`, `subtractQuantities`, and `formatQuantity` using serializable decimal-string results.

- [x] Add pinned `decimal.js` as a direct production dependency.
- [x] Map only KG/G, L/ML, and PCS to canonical unit codes and exact factors.
- [x] Reject negative/malformed amounts, unsupported codes, inactive units, and incompatible dimensions.
- [x] Normalize, convert, compare, add, and non-negative subtract without number coercion.
- [x] Format canonical MASS/VOLUME values in the larger unit at 1000 or above and COUNT as pieces, without changing stored values.
- [x] Run format, lint, and strict TypeScript checks; do not run tests.

### Task 2: Implement carton, finished-good content, and rate utilities

**Files:**

- Create: `src/modules/quantity/domain/cartons.ts`
- Create: `src/modules/quantity/domain/rates.ts`

**Interfaces:**

- Produces serializable `{ cartons, loosePieces, totalPieces }` strings from carton/loose or total-piece inputs.
- Produces `sealedCartonsRequired`, `calculateFinishedGoodContent`, `formatCartonBreakdown`, `pieceRateFromCartonRate`, and `cartonRateFromPieceRate`.

- [x] Parse count inputs as non-negative BigInt-compatible integer strings and enforce positive pieces per carton.
- [x] Normalize overflow loose pieces and convert canonical pieces back to cartons plus loose.
- [x] Calculate sealed cartons with integer ceiling and finished-good content through the shared quantity engine.
- [x] Calculate rates with exact decimals; division rounds HALF_UP only when a repeating result exceeds the caller-selected scale, defaulting to six decimals.
- [x] Reject negative rates, invalid profiles, division by zero, and MASS/VOLUME profile mismatches.
- [x] Run format, lint, and strict TypeScript checks; do not run tests.

### Task 3: Add the server-side calculator application boundary

**Files:**

- Create: `src/modules/quantity/application/contracts.ts`
- Create: `src/modules/quantity/application/calculate-quantity.ts`
- Create: `src/server/quantity/prisma-quantity-catalog.ts`

**Interfaces:**

- Produces a `QuantityCatalog` port for active supported units, unit lookup, active finished-good summaries, and profile lookup.
- Produces `calculateQuantityQuery(input, catalog)` with Zod-validated discriminated unit/carton requests and safe success/error view models.

- [x] Resolve all unit IDs and finished-good profiles server-side through Prisma.
- [x] Validate activity, supported codes, compatible dimensions, decimal scale, integer syntax, and profile completeness.
- [x] Return unit conversion text or normalized carton, total-piece, and total-content results without persistence.
- [x] Keep Prisma and generated types out of public module contracts.
- [x] Run Prisma generation, lint, and strict TypeScript checks; do not run tests.

### Task 4: Build and authorize the quantity calculator UI

**Files:**

- Create: `src/app/(erp)/inventory/quantity-calculator/page.tsx`
- Create: `src/components/quantity/unit-conversion-form.tsx`
- Create: `src/components/quantity/carton-calculator-form.tsx`
- Modify: `src/config/navigation.ts`
- Modify: `src/app/(erp)/inventory/page.tsx`

**Interfaces:**

- The page consumes GET search parameters, calls `requirePermission("inventory.view")`, invokes the calculator application boundary, and renders no client-authoritative arithmetic.
- Forms submit non-persistent GET requests for unit or finished-good carton calculations.

- [x] Add the active `/inventory/quantity-calculator` route and permission-filtered navigation entry.
- [x] Render unit/from/to and finished-good/carton/loose inputs with accessible result and error cards.
- [x] Preserve calculator inputs in the URL without saving them to PostgreSQL.
- [x] Update the inventory landing page to identify Phase 5 math while explicitly excluding stock.
- [x] Run format, lint, strict TypeScript, and production build checks; do not run tests.

### Task 5: Add derived finished-good presentation

**Files:**

- Modify: `src/modules/master-data/application/contracts.ts`
- Modify: `src/server/master-data/prisma-master-data-repository.ts`
- Modify: `src/components/master-data/item-list.tsx`
- Modify: `src/app/(erp)/inventory/finished-goods/page.tsx`

**Interfaces:**

- Finished-good records expose net-content unit code and dimension in addition to existing exact quantity, symbol, and pieces-per-carton fields.
- The list uses shared quantity/carton utilities to render product size and derived net content per carton.

- [x] Map unit code/dimension from Prisma without exposing Prisma decimals.
- [x] Render `net content Ã— pieces/carton` and formatted carton content using shared domain code.
- [x] Show a safe invalid-profile label instead of calculating incomplete data.
- [x] Confirm no stock columns, balances, or transaction behavior are introduced.
- [x] Run format, lint, strict TypeScript, and production build checks; do not run tests.

### Task 6: Document and verify Phase 5

**Files:**

- Modify: `docs/phases/current.md`
- Modify: `docs/product/domain-glossary.md`
- Modify: `docs/architecture/data-integrity.md`
- Modify: `README.md` only if setup commands change

**Interfaces:**

- Documentation records canonical units, supported conversion limits, automatic carton normalization, exact-rate rounding, derived display rules, verification evidence, known limitations, and Phase 6 boundary.

- [x] Run Prettier check, ESLint, Prisma validate/generate, strict TypeScript, production build, migration status, and live database connectivity; do not invoke Vitest or another test suite.
- [x] Inspect the calculator route and finished-good rendering integration, permission guard, shared-formula usage, and absence of stock/ledger fields.
- [x] Update authoritative documentation only after the permitted checks pass.
- [x] Obtain an independent read-only completion audit and stop before the inventory ledger.

## Unresolved product decisions

None. Loose pieces normalize automatically as recommended by the brief. Rate division uses an explicit configurable decimal scale with HALF_UP rounding because repeating decimals cannot be represented finitely; the default scale is six decimals and future pricing modules must choose their own monetary policy.
