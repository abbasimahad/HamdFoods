# Phase 7 Suppliers and Purchase Orders Implementation Plan

> **For agentic workers:** Use the host's available task-by-task implementation workflow. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add supplier masters and exact, auditable purchase-order drafting, approval, cancellation, viewing, printing, and history without inventory or accounting effects.

**Architecture:** A purchasing module owns supplier and PO contracts, exact line calculations, lifecycle rules, and application validation. One Prisma purchasing repository revalidates active references, normalizes quantities through Phase 5, recalculates every monetary value, generates PO numbers server-side, and commits header/line/lifecycle changes transactionally. Next.js server pages and actions enforce Phase 3 RBAC and keep approved/cancelled orders read-only.

**Tech Stack:** TypeScript 6, Next.js 16 App Router, React 19, Prisma 7.9.1, PostgreSQL exact decimals, Zod 4, decimal.js, Tailwind CSS 4.

**Execution status:** COMPLETE

## Global Constraints

- Preserve completed Phase 1-6 architecture, RBAC, masters, quantity rules, and immutable inventory ledger.
- Purchase orders are purchasing commitments only: creation and approval create no inventory, payable, accounting, or journal records.
- Only active RAW_MATERIAL and PACKAGING_MATERIAL items and compatible active supported units may be selected for new/edited orders.
- Authoritative quantities, percentages, rates, and totals use exact decimals and are recalculated server-side.
- DRAFT orders are editable; APPROVED and CANCELLED orders are read-only. Cancellation records actor, time, and reason and never deletes history.
- Acting users are resolved from the authenticated server principal; browser user IDs and totals are never trusted.
- Do not implement Phase 8 receiving or any later purchasing, inventory-costing, payable, or accounting workflow.
- Do not create or run automated tests and do not use agents/subagents, per the explicit brief.
- Do not commit because the repository has no baseline commit.

---

### Task 1: Add purchasing schema and migration

**Files:** Modify `prisma/schema.prisma`; create `prisma/migrations/20260823*_phase7_purchasing/migration.sql`.

- [x] Add Supplier, PurchaseOrder, PurchaseOrderLine, PurchaseOrderSequence, and controlled PurchaseOrderStatus.
- [x] Store entered and canonical quantities, order/canonical unit references, exact rate/percentage/amount snapshots, lifecycle actors/timestamps, and restrictive historical references.
- [x] Add unique codes/numbers, list indexes, decimal/range checks, status metadata checks, and line item-type constraints.
- [x] Generate and apply the migration without creating or running tests.

### Task 2: Implement purchasing domain, application contracts, and exact calculations

**Files:** Create `src/modules/purchasing/domain/purchasing.ts`, `src/modules/purchasing/application/contracts.ts`, `manage-suppliers.ts`, `manage-purchase-orders.ts`, and `listing.ts`.

- [x] Parse supplier and multi-line PO payloads with bounded Zod schemas and normalized master codes.
- [x] Calculate gross, percentage discount, net-before-tax, tax, line total, and PO totals using decimal.js with explicit six-decimal persistence scale.
- [x] Define DRAFT edit, DRAFT-to-APPROVED, DRAFT/eligible-APPROVED-to-CANCELLED rules and safe mutation results.
- [x] Require purchasing.manage in every mutation use case and expose query contracts for server-paginated list/detail/print pages.

### Task 3: Implement the sole Prisma purchasing repository

**Files:** Create `src/server/purchasing/prisma-purchasing-repository.ts`.

- [x] Implement supplier list/detail/save/status without deletion and reject deactivation when active draft purchasing depends on it.
- [x] Generate `PO-YYYY-NNNNNN` numbers using a transactionally incremented yearly sequence.
- [x] Revalidate supplier, items, units, dimensions, quantities, and lifecycle state within Serializable retry transactions.
- [x] Normalize ordered quantities through Phase 5, calculate exact trusted line/header totals, atomically create/edit header and lines, approve, and cancel.
- [x] Perform no writes to InventoryMovement, payable, journal, or accounting models.

### Task 4: Implement suppliers and purchase-order UI

**Files:** Create routes under `src/app/(erp)/purchasing/suppliers` and `purchase-orders`; create focused components under `src/components/purchasing`.

- [x] Build searchable, paginated supplier list/detail/create/edit/status screens guarded by purchasing.view/manage.
- [x] Build multi-line DRAFT create/edit form with item/unit selectors and informative client-side previews; server calculations remain authoritative.
- [x] Build server-filtered PO history, detail actions, approval/cancellation forms, read-only lifecycle display, and browser-print view.
- [x] Preserve entered unit/rate clarity and show canonical quantity, discounts, taxes, totals, actors, and cancellation data.

### Task 5: Integrate navigation, documentation, and verification

**Files:** Modify `src/config/navigation.ts`, purchasing landing page, `docs/phases/current.md`, glossary/data-integrity docs, `README.md`, and `progress.md`.

- [x] Activate Suppliers and Purchase Orders navigation while leaving receiving/invoices/returns planned.
- [x] Apply migration and inspect constraints, lifecycle/RBAC boundaries, and absence of inventory/accounting writes.
- [x] Run only Prettier, Prisma validate/generate/status, database connectivity, TypeScript, ESLint, and production build.
- [x] Update the current phase only after evidence is current and stop before Phase 8.

## Unresolved product decisions

None. Phase 7 uses percentage discounts and taxes per line, PKR/Rs display without introducing a currency master, six-decimal persisted money for exact future integration, and a yearly transaction-backed PO sequence. These are bounded implementation choices consistent with the supplied examples and existing exact-decimal architecture.
