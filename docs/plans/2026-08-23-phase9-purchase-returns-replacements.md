# Phase 9 Purchase Returns & Supplier Replacements Implementation Plan

> **For agentic workers:** Use the host's available task-by-task implementation workflow. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Add traceable physical supplier returns and replacement receiving while preserving the Phase 6 ledger and Phase 8 GRN/QC authority.

**Architecture:** Purchasing owns return documents, replacement obligations, source validation, and PO fulfilment policy. Inventory remains the sole movement writer through transaction-aware functions called inside purchasing Serializable transactions. Replacement arrivals extend the existing GRN and QC records with return-line links; all quantities and progress remain derived from immutable records.

**Tech Stack:** TypeScript 6, Next.js 16 App Router/server actions, Prisma 7, PostgreSQL, Decimal.js, Zod, React 19, Tailwind CSS.

## Global Constraints

- Work in the current session and workspace only; no agents, subagents, delegation, or orchestration.
- Do not create or run automated tests, existing test suites, or aggregate verification commands that run tests.
- Preserve completed Phase 1â€“8 behavior and the central immutable inventory ledger.
- Use exact canonical quantities, server-side decisions, Serializable atomic posting, lot traceability, database lifecycle guards, and server-side RBAC.
- Do not create accounting, payable, invoice, credit-note, tax, costing, production, deployment, or other future-phase effects.

---

### Task 1: Persist return, defect-hold, and replacement provenance

**Files:**

- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260823190000_phase9_purchase_returns_replacements/migration.sql`

**Interfaces:**

- Produces `PurchaseReturn`, `PurchaseReturnLine`, `PurchasedMaterialQuarantine`, and `PurchaseReturnSequence` records plus controlled status/source/reason enums.
- Extends `GoodsReceipt`/`GoodsReceiptLine` with replacement-purpose and return-line provenance.

- [x] Add exact fields, restrictive relations, indexes, source uniqueness, positive quantity constraints, replacement consistency constraints, and server-generated return sequence storage.
- [x] Add PostgreSQL guards making posted return facts immutable, allowing simple cancellation only from DRAFT, and keeping quarantine operations/return lines immutable once authoritative.
- [x] Run `pnpm exec prisma format`, `pnpm db:validate`, and `pnpm db:generate`; expect a valid schema and generated client.

### Task 2: Add central inventory operations for defect quarantine and supplier return

**Files:**

- Modify: `src/server/inventory/transactional-inventory-posting.ts`

**Interfaces:**

- Produces `quarantinePurchasedMaterialInventory(transaction, command)` for AVAILABLE-to-QUARANTINE lot transfers.
- Produces `postPurchaseReturnInventory(transaction, commands)` for PURCHASE_RETURN outflows from QUARANTINE.

- [x] Validate item, warehouse, canonical unit, lot/source GRN, exact positive quantities, and sufficient lot/status balance inside the caller transaction.
- [x] Write linked lot-preserving STATUS_OUT/STATUS_IN movements for defect holds and negative PURCHASE_RETURN movements for physical custody exit with unique source keys.
- [x] Run `pnpm typecheck`; expect no TypeScript errors in the new inventory authority.

### Task 3: Implement purchase-return application and Prisma repository

**Files:**

- Create: `src/modules/purchasing/application/return-contracts.ts`
- Create: `src/modules/purchasing/application/manage-purchase-returns.ts`
- Create: `src/modules/purchasing/application/return-listing.ts`
- Create: `src/server/purchasing/prisma-purchase-return-repository.ts`

**Interfaces:**

- Produces eligible lot/source queries, paginated return records, return draft commands, lifecycle commands, replacement progress, and controlled post-acceptance quarantine command.
- Consumes the Task 2 inventory functions and existing `purchasing.manage` principal contract.

- [x] Derive eligible QC-rejected and post-acceptance defect sources from original GRN/QC/lot history and remaining QUARANTINE ledger stock; never accept arbitrary purchasing-unrelated stock.
- [x] Create/update/cancel DRAFT returns; generate `PR-YYYY-NNNNNN` server-side and revalidate supplier/PO/GRN/lot/source/quantity consistency on every write.
- [x] Post atomically: recheck source entitlement and lot balance, write ledger outflows, record actor/time, move to AWAITING_REPLACEMENT or COMPLETED, and recalculate the PO status.
- [x] Derive replacement required/received/accepted/remaining from return lines and linked GRN/QC data; QC-rejected original returns never reduce accepted fulfilment, while replacement-expected post-acceptance returns do.
- [x] Run `pnpm typecheck` and `pnpm lint`; expect clean application/repository boundaries.

### Task 4: Extend GRN/QC and authoritative PO fulfilment for replacements

**Files:**

- Modify: `src/modules/purchasing/application/receiving-contracts.ts`
- Modify: `src/modules/purchasing/application/manage-goods-receipts.ts`
- Modify: `src/server/purchasing/prisma-goods-receipt-repository.ts`
- Modify: `src/components/purchasing/goods-receipt-form.tsx`
- Modify: `src/app/(erp)/purchasing/goods-receiving/new/page.tsx`
- Modify: `src/app/(erp)/purchasing/goods-receiving/[id]/page.tsx`
- Modify: `src/app/(erp)/purchasing/purchase-orders/[id]/page.tsx`

**Interfaces:**

- Extends `GoodsReceiptInput` with optional replacement return identity and each replacement line with its originating return-line identity.
- Produces one repository-owned PO progress formula used by receiving eligibility, QC completion, PO status, and PO detail.

- [x] Expose outstanding return obligations as replacement GRN targets, including RECEIVED POs whose post-acceptance return reopened fulfilment.
- [x] Require a replacement GRN to match supplier, PO, item, return line, and remaining replacement quantity; do not alter PO prices or totals.
- [x] Reuse normal posting to QUALITY_HOLD and exact QC to AVAILABLE/QUARANTINE; only replacement QC accepted quantity satisfies the linked replacement obligation.
- [x] Refresh affected return and supplier pages and set PO status to PARTIALLY_RECEIVED/RECEIVED from net accepted fulfilment without double-subtracting original QC rejects or double-counting replacements.
- [x] Run `pnpm typecheck` and `pnpm lint`; expect clean integration.

### Task 5: Deliver purchase-return, quarantine, and traceability UI

**Files:**

- Create: `src/components/purchasing/purchase-return-form.tsx`
- Create: `src/components/purchasing/purchase-return-actions.tsx`
- Create: `src/components/purchasing/purchased-material-quarantine-form.tsx`
- Create: `src/app/(erp)/purchasing/purchase-returns/actions.ts`
- Create: `src/app/(erp)/purchasing/purchase-returns/page.tsx`
- Create: `src/app/(erp)/purchasing/purchase-returns/new/page.tsx`
- Create: `src/app/(erp)/purchasing/purchase-returns/quarantine/page.tsx`
- Create: `src/app/(erp)/purchasing/purchase-returns/[id]/page.tsx`
- Create: `src/app/(erp)/purchasing/purchase-returns/[id]/edit/page.tsx`
- Modify: `src/app/(erp)/purchasing/suppliers/[id]/page.tsx`
- Modify: `src/config/navigation.ts`

**Interfaces:**

- Consumes Task 3 repository records and use cases through server actions guarded by `purchasing.manage`; pages use `purchasing.view`.

- [x] Add server-backed search/filter/date/status pagination and status-aware create/edit/post/cancel actions.
- [x] Show header actors, original PO/GRN, lot/source details, returned and replacement quantities, and related replacement GRNs.
- [x] Provide a focused AVAILABLE-to-QUARANTINE action for purchased lots and a source-driven return form displaying server-derived eligible QUARANTINE quantities.
- [x] Activate Purchase Returns navigation and enrich supplier detail with returns and outstanding replacement totals without financial data.
- [x] Run `pnpm typecheck`, `pnpm lint`, and `pnpm build`; expect all Phase 9 routes to compile.

### Task 6: Apply database integrity, document Phase 9, and verify

**Files:**

- Modify: `docs/phases/current.md`
- Modify: `docs/architecture/data-integrity.md`
- Modify: `docs/product/domain-glossary.md`
- Modify: `progress.md`

**Interfaces:**

- Produces the authoritative Phase 9 handoff and implementation evidence.

- [x] Apply the migration with `pnpm exec prisma migrate deploy`; expect all migrations applied to the configured development PostgreSQL database.
- [x] Inspect purchasing code to confirm movement writes remain centralized and no accounting records/effects were introduced.
- [x] Run only `pnpm format`, `pnpm format:check`, `pnpm db:validate`, `pnpm db:generate`, `pnpm typecheck`, `pnpm lint`, `pnpm build`, `pnpm exec prisma migrate status`, and `pnpm db:check`; expect PASS without invoking tests.
- [x] Update current-phase and domain documentation only after the implementation checks pass, then rerun the non-test checks affected by documentation/formatting.

## Externally Observable Decisions

- A posted return moves through transient POSTED and settles immediately as AWAITING_REPLACEMENT when any line expects replacement, otherwise COMPLETED; no manual completion action is required for a no-replacement return.
- Replacement progress is canonical and derived, not an editable counter. A return automatically becomes COMPLETED when linked replacement QC accepted quantity meets every required line.
- One return is constrained to one supplier, PO, source warehouse, and original GRN so header traceability is unambiguous; it may contain multiple eligible lines/lots from that GRN.
- A replacement GRN uses the original PO commercial lines and totals but is explicitly marked REPLACEMENT and linked line-by-line to a return obligation.
- A post-acceptance return reduces PO net fulfilment only when replacement is expected; a no-replacement return records physical custody exit without creating an open supplier obligation.
- Automated tests are intentionally absent and unrun by explicit user instruction.
