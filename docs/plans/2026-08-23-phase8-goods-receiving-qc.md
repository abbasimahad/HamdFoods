# Phase 8 Goods Receiving and Purchase QC Implementation Plan

> **For agentic workers:** Use the host's available task-by-task implementation workflow. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement atomic PO-based goods receiving into QUALITY_HOLD, lot traceability, exact QC classification into AVAILABLE/QUARANTINE, and derived PO fulfilment progress.

**Architecture:** The purchasing module owns GRN/QC lifecycle and derived receipt progress. A transaction-aware inventory authority inside the Phase 6 server boundary is the only component allowed to create purchase and QC ledger movements; the purchasing repository supplies one Serializable Prisma transaction so GRN, lot, movement, QC, and PO status changes commit together. Receipt and QC records remain the source for pending/accepted/rejected/remaining quantities, with no editable counters.

**Tech Stack:** TypeScript 6, Next.js 16 App Router, React 19, Prisma 7.9.1, PostgreSQL exact decimals, Zod 4, decimal.js, Tailwind CSS 4.

**Execution status:** COMPLETE

## Global Constraints

- Preserve completed Phase 1-7 behavior and the immutable signed-canonical inventory ledger.
- DRAFT GRNs have no stock effect; POSTED GRNs create PURCHASE_RECEIPT movements only in QUALITY_HOLD.
- QC atomically moves accepted quantity QUALITY_HOLD to AVAILABLE and rejected quantity QUALITY_HOLD to QUARANTINE, linked to the same inventory lot.
- Supplier, PO line item, canonical unit, and supplier lot identity are server-authoritative; actors come from the authenticated principal.
- Derive ordered, pending QC, accepted, rejected, remaining-to-receive, and remaining-to-fulfil from PO/GRN/QC records.
- Do not implement returns, invoicing, payables, accounting, landed cost, valuation, production, or later modules.
- Do not create or run automated tests and do not use agents/subagents, per the explicit brief.
- Do not commit because the repository has no baseline commit.

---

### Task 1: Add GRN, QC, lot, and movement-reference schema

**Files:** Modify `prisma/schema.prisma`; create `prisma/migrations/20260823*_phase8_goods_receiving_qc/migration.sql`.

- [x] Add GoodsReceipt, GoodsReceiptLine, GoodsReceiptQcDecision, GoodsReceiptSequence, InventoryLot, GRN status, and rejection-reason enums.
- [x] Link movements to optional inventory lots and preserve restrictive supplier/item/PO/warehouse/user history.
- [x] Add exact quantity/date/lifecycle/reconciliation checks, unique source-line decisions/lots, indexes, and database guards that prevent posted receipt-line mutation.
- [x] Generate and apply the migration without creating or running tests.

### Task 2: Extend the centralized inventory authority

**Files:** Modify inventory contracts/domain as needed; create `src/server/inventory/transactional-inventory-posting.ts`; refactor `prisma-inventory-repository.ts` only where required.

- [x] Add transaction-aware purchase receipt posting with PURCHASE_RECEIPT, QUALITY_HOLD, GRN source keys, actor, and lot.
- [x] Add transaction-aware QC status transfers that create linked STATUS_OUT/STATUS_IN rows for accepted and rejected quantities.
- [x] Revalidate canonical quantity, active item/warehouse/unit, lot ownership, sufficient QUALITY_HOLD stock, movement direction, and duplicate sources inside the caller transaction.
- [x] Keep all inventory movement creation inside the inventory server boundary.

### Task 3: Implement receiving/QC application and Prisma repository

**Files:** Create `src/modules/purchasing/application/manage-goods-receipts.ts`, `receiving-contracts.ts`, `receiving-listing.ts`, and `src/server/purchasing/prisma-goods-receipt-repository.ts`; extend PO read models.

- [x] Validate multi-line draft receipt and QC payloads with Zod and purchasing.manage authorization.
- [x] Create/edit/cancel DRAFT GRNs and generate `GRN-YYYY-NNNNNN` server-side.
- [x] At posting, revalidate APPROVED/PARTIALLY_RECEIVED PO, active warehouse, PO line/unit compatibility, canonical quantity, expiry dates, and open receivable quantity in one Serializable transaction.
- [x] Atomically post GRN, lots, QUALITY_HOLD movements, and PARTIALLY_RECEIVED PO status.
- [x] Atomically reconcile every line's accepted+rejected quantity, save QC decisions, post lot-preserving status transfers, complete GRN QC, and set PO RECEIVED only when every line is fully accepted.
- [x] Derive PO line progress and linked GRNs from receipt/QC records; rejected quantity reopens remaining fulfilment.

### Task 4: Build receiving, QC, and PO-progress UI

**Files:** Create `src/app/(erp)/purchasing/goods-receiving/**` and `src/components/purchasing/goods-receipt-*.tsx`; modify PO detail and navigation/landing.

- [x] Build server-paginated GRN history with number/PO/supplier/status/date filters.
- [x] Build DRAFT multi-line create/edit forms constrained to one PO and active warehouse; include lot/manufacture/expiry metadata.
- [x] Build GRN detail with lifecycle actions and POSTED-only QC form requiring exact line reconciliation and rejection reasons.
- [x] Keep POSTED/QC_COMPLETED GRN receipts read-only and expose received/pending/accepted/rejected/remaining progress plus linked GRNs on PO detail.
- [x] Activate Goods Receiving navigation while leaving invoices/returns planned.

### Task 5: Document and verify Phase 8

**Files:** Modify `docs/phases/current.md`, purchasing/inventory integrity docs, glossary, README, plan/progress files.

- [x] Inspect the single movement authority, atomic transaction boundaries, derived progress formulas, lifecycle/RBAC gates, and absence of payable/accounting writes.
- [x] Run only Prettier, Prisma validation/generation/status, database connectivity, TypeScript, ESLint, and production build.
- [x] Update the current phase after evidence is current and stop before Phase 9 purchase returns.

## Unresolved product decisions

None. One GRN line per PO line keeps receipt allocation unambiguous; lot records are created only on posting, including a nullable supplier lot number; QC decisions are one immutable classification per receipt line; rejection reason uses a controlled enum plus optional notes; and both remaining formulas are retained in server read models.
