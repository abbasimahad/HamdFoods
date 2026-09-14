# Purchase Invoice Accounting and Matching Authority — Design

**Date:** 2026-09-14 (amended)
**Baseline:** `e362f5c3305a992a4d963eea1488e7095bb3710d` (`main`, HEAD == origin/main)
**Status:** APPROVED WITH AMENDMENTS. D1–D8 are FROZEN (D6 amended). Design only — not implemented. No schema, migration, or code work until the next explicit go-ahead.
**Route:** `/purchasing/purchase-invoices` (currently `planned`/`MISSING`)

**Amendment log**

- 2026-09-14 v1: initial design, D1–D8 proposed for approval.
- 2026-09-14 v2 (this revision): D1–D8 frozen per operator decision. D6 amended — dedicated `PURCHASE_INVOICE_VARIANCE` ledger type instead of reusing `DEBIT_NOTE`/`CREDIT_NOTE`. D2 amended — matching model changed from a direct `PurchaseInvoiceLine → GoodsReceiptLine` FK to `PurchaseInvoiceLine → PurchaseInvoiceLineMatch → GoodsReceiptLine`, anchoring invoice lines to `PurchaseOrderLine` instead, to support pre-GRN DRAFT invoices. Added: duplicate-invoice-number protection, immutable POST snapshots, payable-aging authority decision, concurrency re-validation, idempotent POST/REVERSE.

This document is derived entirely from the current source, current migrations, and current tests.

---

## 1. CURRENT MODEL (unchanged from v1 — still accurate against source)

### 1.1 Where AP, GRNI, and tax are already recognized

Purchasing today has **no invoice document**. Full AP/GRNI/tax accounting is generated automatically, without any supplier document, by `postGoodsReceiptAcceptanceAccounting()` in [`src/server/accounting/transactional-accounting-posting.ts:556`](../../src/server/accounting/transactional-accounting-posting.ts#L556), invoked when a `GoodsReceipt` reaches `QC_COMPLETED`.

| Step                          | Trigger                                        | Entry                                                                                                                                                                                                    |
| ----------------------------- | ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. GRN posted                 | `GoodsReceipt.status → POSTED`                 | `Dr <item-type Inventory> / Cr GRNI` for the full received value                                                                                                                                         |
| 2. QC completed               | `GoodsReceipt.status → QC_COMPLETED`           | `Dr GRNI / Cr ACCOUNTS_PAYABLE` (+ `Dr INPUT_TAX` or `Dr PURCHASE_TAX_EXPENSE`) for the **accepted** portion, pro-rated from the FINAL `InventoryValuationEntry` basis and `PurchaseOrderLine.taxAmount` |
| 3. Rejected quantity returned | `PurchaseReturn` posted, `source: QC_REJECTED` | `Dr GRNI / Cr Inventory` for the rejected portion                                                                                                                                                        |

**GRNI nets to exactly zero across steps 1–3, entirely without an invoice.** `SupplierPayableLedgerEntry` (`sourceKey: "PURCHASE_ACCEPTANCE:<receiptId>"`, `entryType: PURCHASE_ACCEPTANCE`) is upserted at step 2 and is **already** the open payable item that Payables, payables aging, and Supplier Payments allocation read and pay against.

### 1.2 Price basis has no invoice input today

`GoodsReceiptLine` carries no price field. AP and inventory value are both derived from `PurchaseOrderLine.netAmount − taxAmount`, pro-rated by accepted-quantity ratio.

### 1.3 Tax

`AccountingSettings.purchaseTaxTreatment` (`RECOVERABLE | CAPITALIZE | EXPENSE | NOT_CONFIGURED`) controls the tax leg at GRN QC time only. `CAPITALIZE` and `NOT_CONFIGURED` (when tax > 0) post an attributable `AccountingPostingBlock` — preserved, not routed around.

### 1.4 Inventory valuation

`InventoryValuationEntry` (`entryType: PURCHASE_RECEIPT`, `sourceKey: "GRN-COST:<goodsReceiptLineId>"`) is the authoritative per-line cost basis. Posted `FINAL` entries are immutable at the trigger boundary (`inventory_valuation_entry_immutable`). The only existing revaluation mechanism, `COST_ADJUSTMENT`, revalues the full remaining balance with no on-hand-vs-consumed proration.

### 1.5 Purchase Returns precedent

`PurchaseReturnLine.originalGoodsReceiptLineId` links 1:1 to a `GoodsReceiptLine`; its accounting posts `commercial vs carryingValue` variance to `PURCHASE_RETURN_VARIANCE`. Lifecycle `DRAFT → POSTED → (AWAITING_REPLACEMENT) → COMPLETED/CANCELLED`, gated by `purchasing.manage`, DRAFT-only line mutation enforced by DB trigger, header lifecycle enforced by a second DB trigger.

### 1.6 Reversal precedents

- **Compensating linked document** (`SupplierPayment`): a new document, own number, own POSTED journal via `postDirectAccountJournal()` (**throws**, does not block, on a closed period), plus a new `SupplierPayableLedgerEntry` (`entryType: ADJUSTMENT`, distinct `sourceType` string) with the opposite sign. `hasReversalConflict()` rejects double-reversal.
- **Single-document status flip** (`WasteDisposition`): same document moves `POSTED → REVERSED`, `reversedByUserId/reversedAt/reversalReason` on the header.

### 1.7 Permissions and audit

`purchasing.manage` gates Purchase Orders/GRN/Purchase Returns uniformly; automatic accounting inside a purchasing-gated transaction needs no separate accounting permission. `AuditEntityType` has no `PURCHASE_INVOICE` yet. `SupplierLedgerEntryType.DEBIT_NOTE`/`CREDIT_NOTE` are defined but never written by any code — **reserved, per amendment, for actual supplier debit/credit-note workflows, not for Purchase Invoice variance.**

### 1.8 Payable aging — no due-date authority exists today

`payableAging()` in `financial-reporting.ts:195` buckets every `SupplierPayableLedgerEntry` by `agingBucket(entry.entryDate, asOf)` — **`entry.entryDate`**, which for `PURCHASE_ACCEPTANCE` entries is `receipt.qcCompletedAt ?? receipt.receiptDate` (§1.1 step 2). `SupplierPayableLedgerEntry` **has no `dueDate` field at all**. This is asymmetric with `receivableAging()`, which correctly buckets by `SalesInvoice.dueDate`. Full detail and the resulting decision are in §7.

### 1.9 Closed periods — two coexisting behaviors

`postAutomaticJournal()` (GRN QC, Purchase Return): **blocks** (writes `AccountingPostingBlock`, no throw) when no OPEN period contains the date. `postDirectAccountJournal()` (reversals, manual journals): **throws**.

---

## 2. RECOMMENDED MODEL — FROZEN (D1)

> **Purchase Invoice is a PO → GRN → Invoice matching/true-up document. It does not originate AP again.**
>
> - **Exact match:** no accounting journal, no payable-ledger adjustment. The posted invoice and its matching records still exist as immutable, audited proof that the supplier's paper reconciles to what GRN QC already recognized.
> - **Variance:** only the delta between the supplier's invoiced amount and the GRN-derived basis affects AP/accounting — never the full invoiced amount.

GRNI is **never touched** by Purchase Invoice — it is already fully cleared by the GRN→QC pipeline before any invoice exists (§1.1). "Matching" in this design is the confirmation that physical (GRN) and commercial (invoice) records agree; it is not a GRNI ledger posting.

---

## 3. MATCHING — FROZEN (D2, amended)

### 3.1 Model: `PurchaseInvoice → PurchaseInvoiceLine → PurchaseInvoiceLineMatch → GoodsReceiptLine`

Per the amendment, **`PurchaseInvoiceLine` does not FK directly to a `GoodsReceiptLine`.** Instead:

- `PurchaseInvoiceLine.purchaseOrderLineId` — **retains PO-line identity**. This is what lets an invoice line exist before any GRN line does (§3.4). Every PO line is supplier + item + canonical-unit + price anchored, and (per §1.2/audit R6) every receipt in this system is PO-bound with no non-PO path — so anchoring to the PO line, not the GRN line, is the only anchor available before goods arrive.
- `PurchaseInvoiceLineMatch` — a new join table, one row per `(purchaseInvoiceLineId, goodsReceiptLineId)` pair, carrying `matchedQuantity` and (frozen at POST only, §4) the per-match variance basis. **Absent entirely while the invoice line has no GRN allocation yet.**

This directly supports every required shape:

| Requirement                                        | How                                                                                                                                                                                                              |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Invoice before GRN, as DRAFT                       | `PurchaseInvoiceLine` created against a `PurchaseOrderLine` with **zero** `PurchaseInvoiceLineMatch` rows. Valid DRAFT state.                                                                                    |
| One invoice line matched across multiple GRN lines | Multiple `PurchaseInvoiceLineMatch` rows share the same `purchaseInvoiceLineId`, each pointing at a different `goodsReceiptLineId` (e.g., the PO line was received across two partial GRNs).                     |
| Multiple invoices against one GRN line             | Multiple `PurchaseInvoiceLineMatch` rows (from different invoices' lines) share the same `goodsReceiptLineId`. No uniqueness constraint prevents this — only the aggregate remaining-quantity check (§3.3) does. |
| Partial matching                                   | `SUM(matches.matchedQuantity)` for a line may be `< invoicedQuantity` while DRAFT — flagged incomplete, blocked from POST (§4.1), not blocked from saving.                                                       |
| Exact remaining-to-invoice                         | Derived aggregate, §3.3.                                                                                                                                                                                         |

### 3.2 Cross-entity integrity guard

A new DB trigger (`purchase_invoice_match_line_identity_guard`) rejects any `PurchaseInvoiceLineMatch` insert/update where the referenced `GoodsReceiptLine.purchaseOrderLineId` does not equal the parent `PurchaseInvoiceLine.purchaseOrderLineId` — mirroring the existing composite cross-check style used for GRN replacement lines (`goods_receipt_replacement_line_guard`). This prevents matching an invoice line to a GRN line that fulfilled a _different_ PO line.

### 3.3 Remaining-to-invoice quantity (derived, not stored)

New `calculatePurchaseInvoiceMatching(client, goodsReceiptLineIds)`, styled exactly on the existing `calculatePurchaseOrderFulfilment()`:

```
acceptedQuantity  = GoodsReceiptQcDecision.acceptedQuantity                         (existing)
matchedToDate     = SUM(PurchaseInvoiceLineMatch.matchedQuantity)
                     WHERE goodsReceiptLineId = X
                     AND purchaseInvoiceLine.purchaseInvoice.status = 'POSTED'        -- DRAFT matches do not reserve
remainingToInvoice = MAX(acceptedQuantity - matchedToDate, 0)
```

**DRAFT matches never reserve quantity.** Two DRAFT invoices may both hold provisional matches against the same GRN line's full remaining balance; only POST is a binding, re-validated commit (§6.4 Concurrency) — this is consistent with how every other DRAFT document in this system (POs, batches, returns) is non-binding until posted.

### 3.4 Invoice before GRN (requirement 3) — DRAFT-only, unchanged conclusion

A `PurchaseInvoice` may be saved as DRAFT with lines anchored only to `PurchaseOrderLine`s and zero matches — the paper is not lost. It **cannot be POSTED** until every line is fully matched (§4.1) against `QC_COMPLETED` GRN lines. Full non-PO/pre-PO invoicing remains out of scope (unchanged from v1; no PO-less purchasing path exists anywhere in this system to invoice against).

### 3.5 Invoice after GRN (requirement 2)

Unchanged: the normal, fully supported path. DRAFT lines are matched against existing `QC_COMPLETED` GRN lines immediately.

---

## 4. VARIANCES — FROZEN (D3)

### 4.1 Quantity variance — hard POST-blocking validation, zero tolerance, never posted

Two independent checks, both must pass for POST to succeed:

```
(a) Per invoice line — matching completeness:
    SUM(line.matches[].matchedQuantity) == line.invoicedQuantity
    (else: "Line N is not fully matched to received quantity.")

(b) Per GRN line referenced by any match on this invoice — physical availability,
    re-read transactionally at POST (§6.4):
    SUM(all POSTED invoices' matches against that GRN line) <= GoodsReceiptQcDecision.acceptedQuantity
    (else: "Matched quantity exceeds the GRN line's accepted, unbilled balance.")
```

Either failure **blocks POST outright** — no partial posting, no variance entry, no tolerance. DRAFT may hold an incomplete or (transiently, before another invoice posts first) over-subscribed state for editing purposes; only POST enforces zero-tolerance completeness. GRN's `GoodsReceiptQcDecision.acceptedQuantity` remains the sole physical-quantity authority — this design adds no new quantity truth.

### 4.2 Price variance

At POST (not at match-creation time — frozen only once, per the immutable-snapshot requirement, §5.3), for each `PurchaseInvoiceLineMatch`, read the matched `GoodsReceiptLine`'s `GRN-COST:<lineId>` FINAL `InventoryValuationEntry`, derive a per-canonical-unit rate, and freeze:

```
grnDerivedUnitCost   = FINAL valuation valueDelta / GoodsReceiptLine.normalizedQuantity
priceVarianceAmount  = (invoiceLine.invoicedUnitRate - grnDerivedUnitCost) * match.matchedQuantity
```

Summed across all matches on the invoice and posted, only if non-zero, **entirely to P&L** — never by reopening or re-prorating the immutable `FINAL` valuation entry (D3: "no retroactive mutation/revaluation of FINAL inventory valuation"):

```
priceVarianceAmount > 0 (supplier billed more than GRN cost):
  Dr PURCHASE_PRICE_VARIANCE   priceVarianceAmount
    Cr ACCOUNTS_PAYABLE          priceVarianceAmount   (supplierId)

priceVarianceAmount < 0 (supplier billed less):
  Dr ACCOUNTS_PAYABLE          |priceVarianceAmount|
    Cr PURCHASE_PRICE_VARIANCE   |priceVarianceAmount|
```

`PURCHASE_PRICE_VARIANCE` is a new `AccountingMappingKey`, symmetrical to the existing `PURCHASE_RETURN_VARIANCE`/`INVENTORY_VARIANCE`.

### 4.3 Tax variance

Same per-match freeze, using the existing tax-treatment-dependent mapping (no new mapping key needed):

```
grnDerivedTaxAmount = the same pro-rata tax basis §1.1 step 2 already computes for this GRN line
taxVarianceAmount   = match-proportional invoiceLine.taxAmount - grnDerivedTaxAmount

NOT_CONFIGURED and taxVarianceAmount != 0  → block (reuse PURCHASE_TAX_NOT_CONFIGURED)
CAPITALIZE and taxVarianceAmount != 0      → block (reuse PURCHASE_TAX_POLICY_REQUIRES_VALUATION_SUPPORT)
RECOVERABLE / EXPENSE                      → Dr/Cr {INPUT_TAX | PURCHASE_TAX_EXPENSE} against ACCOUNTS_PAYABLE
```

### 4.4 One journal per invoice

All matches' price and tax variances combine into **one** `postAutomaticJournal()` call per invoice, sourced `PURCHASE_INVOICE_VARIANCE:<invoiceId>` — the same aggregation style `postGoodsReceiptAcceptanceAccounting()` already uses across multiple lines.

### 4.5 Tolerance

None in V1 (D7, reaffirmed). Any non-zero variance to `Decimal(24,6)` scale posts; no materiality/rounding policy is invented.

---

## 5. LIFECYCLE — FROZEN (D5) + immutable snapshots

`PurchaseInvoiceStatus`: `DRAFT → POSTED → REVERSED`, `DRAFT → CANCELLED`.

### 5.1 POST

Guarded, Serializable transaction:

1. **Guarded status transition first** (idempotency + concurrency root, §6): `UPDATE purchase_invoice SET status='POSTED', ... WHERE id=$1 AND status='DRAFT'`; if affected rows ≠ 1, abort with "already posted or no longer a draft" — no further side effect runs.
2. Re-validate §4.1(a) and §4.1(b) **inside the same transaction**, against freshly re-read rows (not values cached from the DRAFT-editing session).
3. Freeze `grnDerivedUnitCost`, `grnDerivedTaxAmount`, `priceVarianceAmount`, `taxVarianceAmount` onto every `PurchaseInvoiceLineMatch` (§5.3).
4. If net variance ≠ 0: `postAutomaticJournal()` (§4.4) → may itself return `blocked: true` (tax-policy block), which still leaves the invoice POSTED with an outstanding `AccountingPostingBlock`, exactly as GRN QC tolerates today. Then `upsert` (not `create`) one `SupplierPayableLedgerEntry` keyed `sourceKey: "PURCHASE_INVOICE_VARIANCE:<invoiceId>"`, `entryType: PURCHASE_INVOICE_VARIANCE` (§7).
5. `recordAuditEvent()`, action `POST`, `entityType: PURCHASE_INVOICE`.

### 5.2 CANCEL (DRAFT only)

Guarded `UPDATE ... WHERE id=$1 AND status='DRAFT'`, reason required, no accounting existed to reverse. Mirrors `cancelPurchaseReturn`.

### 5.3 Immutable POST snapshot

Once step 1 of §5.1 succeeds, a header-level DB trigger (mirroring `enforce_goods_receipt_lifecycle()`'s field-allowlist style exactly) rejects any further change to: `supplierId`, `supplierInvoiceNumber`, `invoiceDate`, `dueDate`, `notes`, `subtotal`, `taxTotal`, `grandTotal`. A line-level trigger (mirrors `purchase_return_line_update_guard`) rejects mutation of `PurchaseInvoiceLine` once the parent is not `DRAFT`. A match-level trigger does the same for `PurchaseInvoiceLineMatch`, additionally covering the four frozen-at-POST columns (`grnDerivedUnitCost`, `grnDerivedTaxAmount`, `priceVarianceAmount`, `taxVarianceAmount`) so they cannot be touched again after the one write in step 3. Together these freeze exactly the list required: supplier invoice number, invoice date, matched quantities, invoice prices, tax amounts/treatment (frozen implicitly — `purchaseTaxTreatment` is read from `AccountingSettings` only at POST and the resulting `taxVarianceAmount`/journal lines are then immutable), variance amounts, GRN allocations, and accounting references (`AccountingJournal`/`SupplierPayableLedgerEntry` are already immutable via existing triggers).

### 5.4 REVERSE (POSTED only) — FROZEN (D5)

> Original POSTED invoice remains immutable. Use compensating journal/payable adjustments when variance existed. Exact-match reversal has no fabricated accounting. Closed-period rules apply. No editing/deleting original postings.

Guarded `UPDATE purchase_invoice SET status='REVERSED', reversedByUserId=$actor, reversedAt=now(), reversalReason=$reason WHERE id=$1 AND status='POSTED'`; affected rows ≠ 1 aborts (idempotent against duplicate REVERSE clicks, §6.5). `hasReversalConflict()`-style check retained as a pre-flight (redundant with the guarded update, defense in depth).

- **If a variance journal/ledger entry exists** (net variance was non-zero at POST): compensating `postDirectAccountJournal()` — **throws**, does not block, on a closed period (matching `reverseSupplierPayment()` precedent) — sourced `PURCHASE_INVOICE_REVERSAL:<invoiceId>`, plus an opposite-signed `SupplierPayableLedgerEntry` (`entryType: ADJUSTMENT` — reusing the generic reversal type exactly as `reverseSupplierPayment()` does for its own reversal row, rather than inventing a fifth ledger type; `sourceType: "PURCHASE_INVOICE_REVERSAL"` disambiguates it).
- **If the invoice was a pure exact match** (no journal/ledger ever existed): status flip only — nothing to compensate, "no fabricated accounting" per D5. The invoice's matches simply drop out of §3.3's `matchedToDate` aggregate (status no longer `POSTED`), freeing the GRN quantity for a future invoice.
- The original invoice's header/line/match rows are never edited — REVERSE only ever writes the four reversal columns on the header (already covered by the §5.3 trigger's allowlist) plus the new compensating journal/ledger rows.

---

## 6. SCHEMA

### 6.1 New enums

```prisma
enum PurchaseInvoiceStatus {
  DRAFT
  POSTED
  CANCELLED
  REVERSED
}
```

`SupplierLedgerEntryType` gains one value (D6 amendment):

```prisma
enum SupplierLedgerEntryType {
  PURCHASE_ACCEPTANCE
  PURCHASE_RETURN_CREDIT
  SUPPLIER_PAYMENT
  DEBIT_NOTE               // unchanged — reserved for real supplier debit-note workflows, NOT used by this design
  CREDIT_NOTE               // unchanged — reserved for real supplier credit-note workflows, NOT used by this design
  OPENING_BALANCE
  ADJUSTMENT
  PURCHASE_INVOICE_VARIANCE // new — dedicated type for Purchase Invoice price/tax true-up
}
```

### 6.2 New models

```prisma
model PurchaseInvoice {
  id                    String                @id @default(uuid())
  number                String                @unique
  supplierId            String
  supplierInvoiceNumber String
  invoiceDate           DateTime              @db.Date
  dueDate               DateTime?             @db.Date   // informational only — see §7; not read by payableAging()
  status                PurchaseInvoiceStatus @default(DRAFT)
  notes                 String?
  subtotal              Decimal               @db.Decimal(24, 6)
  taxTotal              Decimal               @db.Decimal(24, 6)
  grandTotal            Decimal               @db.Decimal(24, 6)
  priceVarianceTotal    Decimal               @default(0) @db.Decimal(24, 6)   // 0 until POST; frozen after
  taxVarianceTotal      Decimal               @default(0) @db.Decimal(24, 6)   // 0 until POST; frozen after
  createdByUserId       String
  postedByUserId        String?
  postedAt              DateTime?
  cancelledByUserId     String?
  cancelledAt           DateTime?
  cancellationReason    String?
  reversedByUserId      String?
  reversedAt            DateTime?
  reversalReason        String?
  createdAt             DateTime              @default(now())
  updatedAt             DateTime              @updatedAt
  supplier              Supplier              @relation(fields: [supplierId], references: [id], onDelete: Restrict)
  createdBy             User                  @relation("PurchaseInvoiceCreatedBy", fields: [createdByUserId], references: [id], onDelete: Restrict)
  postedBy              User?                 @relation("PurchaseInvoicePostedBy", fields: [postedByUserId], references: [id], onDelete: Restrict)
  cancelledBy            User?                @relation("PurchaseInvoiceCancelledBy", fields: [cancelledByUserId], references: [id], onDelete: Restrict)
  reversedBy             User?                @relation("PurchaseInvoiceReversedBy", fields: [reversedByUserId], references: [id], onDelete: Restrict)
  lines                 PurchaseInvoiceLine[]

  @@unique([supplierId, supplierInvoiceNumber], map: "purchase_invoice_supplier_number_uidx")
  @@index([status, invoiceDate])
  @@index([supplierId, invoiceDate])
  @@map("purchase_invoice")
}

model PurchaseInvoiceLine {
  id                  String                    @id @default(uuid())
  purchaseInvoiceId   String
  position            Int
  purchaseOrderLineId String
  itemId              String
  invoicedQuantity    Decimal                   @db.Decimal(24, 6)
  invoicedUnitRate    Decimal                   @db.Decimal(24, 6)
  taxPercent          Decimal                   @db.Decimal(7, 4)
  grossAmount         Decimal                   @db.Decimal(24, 6)
  taxAmount           Decimal                   @db.Decimal(24, 6)
  netAmount           Decimal                   @db.Decimal(24, 6)
  notes               String?
  purchaseInvoice     PurchaseInvoice           @relation(fields: [purchaseInvoiceId], references: [id], onDelete: Cascade)
  purchaseOrderLine   PurchaseOrderLine         @relation(fields: [purchaseOrderLineId], references: [id], onDelete: Restrict)
  item                Item                      @relation(fields: [itemId], references: [id], onDelete: Restrict)
  matches             PurchaseInvoiceLineMatch[]

  @@unique([purchaseInvoiceId, position])
  @@index([purchaseOrderLineId])
  @@index([itemId])
  @@map("purchase_invoice_line")
}

model PurchaseInvoiceLineMatch {
  id                  String              @id @default(uuid())
  purchaseInvoiceLineId String
  goodsReceiptLineId  String
  matchedQuantity     Decimal             @db.Decimal(24, 6)
  grnDerivedUnitCost  Decimal             @default(0) @db.Decimal(30, 12)   // 0 until POST; frozen after
  grnDerivedTaxAmount Decimal             @default(0) @db.Decimal(24, 6)    // 0 until POST; frozen after
  priceVarianceAmount Decimal             @default(0) @db.Decimal(24, 6)    // 0 until POST; frozen after
  taxVarianceAmount   Decimal             @default(0) @db.Decimal(24, 6)    // 0 until POST; frozen after
  createdAt           DateTime            @default(now())
  purchaseInvoiceLine PurchaseInvoiceLine @relation(fields: [purchaseInvoiceLineId], references: [id], onDelete: Cascade)
  goodsReceiptLine    GoodsReceiptLine    @relation(fields: [goodsReceiptLineId], references: [id], onDelete: Restrict)

  @@unique([purchaseInvoiceLineId, goodsReceiptLineId], map: "purchase_invoice_line_match_uidx")
  @@index([goodsReceiptLineId])
  @@map("purchase_invoice_line_match")
}

model PurchaseInvoiceSequence {
  year      Int @id
  nextValue Int

  @@map("purchase_invoice_sequence")
}
```

### 6.3 Existing-enum additions

```prisma
enum AccountingMappingKey {
  // ...existing values...
  PURCHASE_PRICE_VARIANCE   // new
}

enum AccountingSourceType {
  // ...existing values...
  PURCHASE_INVOICE_VARIANCE    // new — the true-up journal
  PURCHASE_INVOICE_REVERSAL    // new — the compensating journal
}

enum AuditEntityType {
  // ...existing values...
  PURCHASE_INVOICE   // new
}
```

`accountingSourceAuditEntityType()` gets one new branch mapping both new source types to `PURCHASE_INVOICE`.

### 6.4 Duplicate-invoice protection (ADD 1)

`@@unique([supplierId, supplierInvoiceNumber])` on `PurchaseInvoice` (§6.2) — the repository's normal convention (matches the DB-level `@@unique` + `P2002 → "conflict"` translation already used for master-data codes, `repositoryError()` in `prisma-master-data-repository.ts:465`). `supplierInvoiceNumber` is `z.string().trim().min(1).max(120)` at the Zod boundary (same `.trim()` convention used throughout `return-contracts.ts`/`sales-invoice-contracts.ts`); no case-folding is applied because no existing normalized-key field in this codebase case-folds either (item/supplier codes rely on consistent entry, not server-side normalization).

The constraint is **header-level, not status-scoped** — a DRAFT or CANCELLED invoice still reserves its `(supplier, number)` pair, consistent with this codebase's immutability philosophy (a cancelled document is never silently made available for reuse; a genuine mis-entry is corrected by editing the same DRAFT or creating a new invoice under the correct number). This directly satisfies "same supplier + same supplier invoice number must not post twice" and is strictly stronger (blocks duplicate _entry_, not just duplicate _posting_).

### 6.5 Database guards (new migration, mirrors phase 8/9/23 style)

- `purchase_invoice_lifecycle_guard` — `BEFORE UPDATE` on `purchase_invoice`: rejects status transitions outside `DRAFT→POSTED`, `DRAFT→CANCELLED`, `POSTED→REVERSED`, **and** rejects any change to the content-field allowlist (§5.3) once `status <> 'DRAFT'` — same two-part function shape as `enforce_goods_receipt_lifecycle()`.
- `purchase_invoice_line_mutation_guard` — `BEFORE UPDATE OR DELETE` on `purchase_invoice_line`: rejects mutation once the parent is not `DRAFT`.
- `purchase_invoice_line_match_mutation_guard` — `BEFORE UPDATE OR DELETE` on `purchase_invoice_line_match`: rejects mutation of `matchedQuantity`/`goodsReceiptLineId` once the parent invoice is not `DRAFT`, and separately rejects any change to the four frozen variance columns once they have been written (non-default) at all — belt-and-braces alongside the header/line status check.
- `purchase_invoice_match_line_identity_guard` — `BEFORE INSERT OR UPDATE` on `purchase_invoice_line_match` (§3.2): rejects a match whose `GoodsReceiptLine.purchaseOrderLineId` disagrees with its parent `PurchaseInvoiceLine.purchaseOrderLineId`.

### 6.6 No change to any existing model, trigger, or posting function

`GoodsReceipt`, `GoodsReceiptLine`, `PurchaseOrderLine`, `InventoryValuationEntry`, `SupplierPayableLedgerEntry` (schema unchanged — only new rows, no new columns), `postGoodsReceiptAcceptanceAccounting()`, and `postValuedInbound()` remain untouched.

---

## 7. PAYABLE AGING / DUE-DATE AUTHORITY (ADD 3) — documented limitation, not invented

Per §1.8: `payableAging()` currently ages **every** `SupplierPayableLedgerEntry` (not just future Purchase-Invoice-related ones) from `entry.entryDate`, and the model has no `dueDate` column at all. Wiring `PurchaseInvoice.dueDate` into aging would require either:
(a) adding a `dueDate` column to `SupplierPayableLedgerEntry` and changing `payableAging()`'s bucket source for **every** historical and future payable entry (a behavior change to a certified financial report, affecting entries this design does not otherwise touch), or
(b) a parallel, invoice-specific aging calculation that would disagree with the existing report for any GRN not yet invoiced.

**Neither is done by this design.** `PurchaseInvoice.dueDate` (computed from `Supplier.paymentTermsDays` + `invoiceDate`, or entered directly) is **informational only** — displayed on the invoice detail page for the user's reference — and is **not** read by `payableAging()`, `financial-reporting.ts`, or any report. `payableAging()` is not modified by this workflow. If accurate invoice-due-date aging is wanted, it is a separate, explicitly scoped enhancement (adding `dueDate` to `SupplierPayableLedgerEntry` and updating the certified aging report), requiring its own approval — not inferred here.

---

## 8. PERMISSIONS — FROZEN (D8)

`purchasing.manage` only, full lifecycle (create/edit/POST/CANCEL/REVERSE) — no new `PermissionCode`, consistent with GRN QC and Purchase Return precedent.

---

## 9. AUDIT / IMMUTABILITY

- Every lifecycle transition writes `recordAuditEvent()` (`entityType: PURCHASE_INVOICE`): `CREATE`/`UPDATE` on save, `POST`, `CANCEL` (reasonCode), `REVERSE` (`reasonCode: ACCOUNTING_CORRECTION`, `controlEvent: true`, `related` pointing at the original), and `CONTROL_BLOCKED` automatically inherited from `postAutomaticJournal()`'s existing `block()` helper.
- Because every audit-triggering step (§5.1–§5.4) runs **after** its guarded status-transition `UPDATE ... WHERE status = $expected` succeeds, a losing concurrent duplicate never reaches `recordAuditEvent()` — no duplicate audit rows (ADD 5).
- Posted invoice/line/match rows are immutable at the PostgreSQL boundary (§5.3, §6.5).
- `AuditEvent` itself remains append-only via the existing trigger — unchanged.

---

## 10. IDEMPOTENCY (ADD 5) and CONCURRENCY (ADD 4)

Both are the same mechanism applied consistently, following the exact idiom already proven in `closeAccountingPeriod()`/`reopenAccountingPeriod()` (`updateMany({ where: { id, status: X }, ... }); if (count !== 1) throw`):

1. **POST** and **REVERSE** each open one `prisma.$transaction(..., { isolationLevel: "Serializable" })`.
2. The **first statement** inside that transaction is the guarded status-changing `updateMany` (`WHERE id = $1 AND status = $expectedStatus`). If `count !== 1`, the transaction aborts immediately with an explicit error ("already posted", "not a draft", "not posted", "already reversed") — **no match row, ledger row, journal, or audit event is created** by a losing duplicate submission (ADD 5, both for accidental double-clicks and for retried network requests, matching the `single-flight-form`/`pending-button` client-side protection already standard across this codebase's forms, which this workflow reuses unchanged per the existing data-entry UX rules).
3. §4.1(b)'s GRN-availability check is re-read **inside the same Serializable transaction**, after step 2, against the current database state — not against values cached from when the DRAFT was last edited. Two concurrent POST attempts against overlapping GRN quantity: the first to commit its guarded update proceeds; the second either fails the re-read quantity check (explicit, readable rejection) or, if both read concurrently under `Serializable`, one is rolled back by PostgreSQL with a serialization-failure error that the application surfaces as "the receipt quantity changed — please re-check matching and retry" (ADD 4 — matches exactly how `docs/architecture/data-integrity.md` already describes purchase-return posting rechecking "exact lot/status stock ... within the same Serializable transaction").
4. `AccountingJournal.@@unique([sourceType, sourceId])` and `SupplierPayableLedgerEntry.upsert()` (§5.1 step 4) provide a second, independent layer of idempotency for the accounting side specifically, identical to the pattern `postGoodsReceiptAcceptanceAccounting()` already relies on.

No new locking primitive, queue, or reservation table is introduced — this reuses the transaction-isolation pattern already authoritative everywhere else in the codebase.

---

## 11. TEST PLAN

### 11.1 Domain unit tests (`src/modules/purchasing/domain/purchase-invoice.test.ts`, new)

- quantity completeness (§4.1a) and GRN-availability (§4.1b) rejection, independently
- price-variance sign/amount calculation (§4.2), zero-variance case
- tax-variance calculation across all three `purchaseTaxTreatment` values, both block conditions (§4.3)
- pre-GRN line (zero matches) is valid for DRAFT, invalid for POST

### 11.2 Application-layer unit tests (`manage-purchase-invoices.test.ts`, new)

Permission denial without `purchasing.manage`; Zod rejection of malformed input; DRAFT-only line/match mutation; `hasReversalConflict()` reuse rejects double-reverse; duplicate `(supplierId, supplierInvoiceNumber)` on create surfaces the P2002-translated conflict message (ADD 1).

### 11.3 Integration (`src/test/phase27-golden-workflow.ts` extension + new `purchase-invoice.integration.test.ts`)

- exact match posts **zero** journals and **zero** new `SupplierPayableLedgerEntry` rows (assert counts unchanged) — proves D1's core guarantee
- price variance both directions; tax variance under `RECOVERABLE`/`EXPENSE`; `CAPITALIZE`/`NOT_CONFIGURED` produce `AccountingPostingBlock`, not a fabricated journal
- one invoice line matched across two GRN lines (partial receipts against one PO line) — both matches, one journal
- two invoices against one GRN line, second exactly exhausting `remainingToInvoice` — third attempt against the same line is rejected
- pre-GRN DRAFT invoice: saves with zero matches, POST attempt rejected with the exact §4.1(a) message; once a GRN posts and QC completes, adding the match and posting succeeds
- **duplicate invoice number**: second `createPurchaseInvoice` for the same `(supplierId, supplierInvoiceNumber)` is rejected before any DB write (ADD 1)
- **concurrency**: two invoices, each fully matching the same GRN line's full remaining quantity, POSTed concurrently — assert exactly one succeeds, the other receives an explicit rejection, and `matchedToDate` never exceeds `acceptedQuantity` (ADD 4)
- **idempotency**: issuing POST twice in sequence for the same invoice id — second call is rejected with no duplicate journal/ledger/audit row; same for REVERSE (ADD 5)
- reversal of a variance invoice — compensating journal nets `ACCOUNTS_PAYABLE` back to zero effect; reversal of an exact-match invoice — no journal exists to reverse, status flips, matched quantity reopens
- closed-period POST with a variance → block (not throw); closed-period REVERSE → throw (§1.9, asymmetry preserved deliberately)
- `payableAging()` output is **unchanged** by posting a Purchase Invoice with a variance (only the underlying `SupplierPayableLedgerEntry.entryDate`-bucketed total changes, exactly as it would for any other ledger entry) — proves §7's "no mutation of historical payable ledger truth" guarantee
- control-account reconciliation still balances at period-close readiness

### 11.4 E2E (`e2e/purchase-invoices.spec.ts`, new)

List/create/detail/edit workbench using only existing shared data-entry components (`searchable-select`, `line-editor-controls`, `pending-button`, `single-flight-form`). Create DRAFT with a PO line and no GRN match; add a match once a GRN exists; post exact match (UI shows no accounting effect); post with variance (UI shows the frozen variance and resulting payable delta); attempt duplicate invoice number (inline conflict message); cancel DRAFT; reverse POSTED; permission-denied redirect without `purchasing.manage`; responsive containment at 375/768/1280.

---

## 12. RISKS

- **R1 (unchanged).** Vocabulary mismatch with textbook GRNI/AP expectations — mitigated by explicit documentation in §2.
- **R2 (unchanged).** Price variance never restates on-hand inventory value (D3).
- **R3 (superseded by D2 amendment).** Pre-GRN invoices are no longer purely DRAFT-trapped with no way to express intent — they can now be fully entered against the PO line and simply await matching; CANCEL remains available regardless of match state.
- **R4 (unchanged).** `LANDED_COST_CLEARING` remains unsettled — pre-existing gap, out of scope (D4).
- **R5 (unchanged).** Two closed-period behaviors (block vs. throw) coexist by design (§1.9/§11.3) — must stay explicitly tested so it is never "fixed" into an inconsistency.
- **R6 (unchanged).** Historical GRNs predating this feature have no invoice linkage — expected.
- **R7 (new).** `payableAging()` continues to age from GRN-acceptance date, not invoice due date, for every payable entry including those later matched by a Purchase Invoice (§7). This is a pre-existing report limitation this design deliberately does not fix; documented so it is not mistaken for a Purchase Invoice defect.
- **R8 (new).** The match-table model (§3) is more schema surface than a direct FK — three new tables/guards instead of one. Accepted because it is the only shape that satisfies pre-GRN DRAFT + multi-GRN + multi-invoice matching simultaneously without a second reservation/holding mechanism.

---

## 13. FINAL DECISION LOG (D1–D8, frozen)

| #   | Decision                                                                                                                                                                                                                                                                        | Status                                                                    |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| D1  | Purchase Invoice is a matching/true-up document; never re-originates AP. Exact match posts nothing but leaves immutable matching records. Variance-only accounting.                                                                                                             | **APPROVED**                                                              |
| D2  | Matching model is `PurchaseInvoiceLine → PurchaseInvoiceLineMatch → GoodsReceiptLine`, with `PurchaseInvoiceLine` anchored to `PurchaseOrderLine` (not `GoodsReceiptLine`) to support pre-GRN DRAFT, multi-GRN, and multi-invoice matching. POST requires full, valid matching. | **APPROVED WITH MATCHING MODEL CHANGE** (superseded v1's direct-FK model) |
| D3  | Price/tax variance is AP true-up + P&L/tax only, never retroactive valuation mutation. Quantity mismatch blocks POST at zero tolerance; GRN remains physical-quantity authority.                                                                                                | **APPROVED**                                                              |
| D4  | Landed-cost invoicing out of scope.                                                                                                                                                                                                                                             | **APPROVED**                                                              |
| D5  | Reversal: original POSTED invoice immutable; compensating journal/payable adjustment only where variance existed; exact-match reversal fabricates nothing; closed-period rules apply; no editing/deleting original postings.                                                    | **APPROVED**                                                              |
| D6  | Dedicated `SupplierLedgerEntryType.PURCHASE_INVOICE_VARIANCE` for Purchase Invoice variance. `DEBIT_NOTE`/`CREDIT_NOTE` remain reserved, untouched, for real supplier debit/credit-note workflows.                                                                              | **AMENDED — implemented as amended, superseding v1's D6 recommendation**  |
| D7  | No materiality/variance tolerance in V1; any non-zero quantity mismatch blocks POST.                                                                                                                                                                                            | **APPROVED**                                                              |
| D8  | `purchasing.manage` only; no new permission.                                                                                                                                                                                                                                    | **APPROVED**                                                              |

**No implementation, migration, or code change proceeds until the operator gives the next explicit go-ahead.**
