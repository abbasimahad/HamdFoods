# Data integrity rules

These are architectural invariants for future phases; Phase 1 does not implement their business engines.

## Exact values

JavaScript floating-point arithmetic must not determine money, rates, taxes, discounts, costing, or precision-sensitive quantities. Domain arithmetic uses `decimal.js` and serializable decimal strings. Phase 7 purchase orders persist quantities, rates, and amounts at six decimals and percentages at four decimals; every authoritative line and header total is recalculated server-side with HALF_UP rounding at the persistence scale.

## Inventory

Inventory is movement/ledger based. Never make an editable `currentStock` field authoritative. Phase 6 stores nonzero signed canonical quantities in immutable movement rows and calculates stock with ledger sums by item, warehouse, and status. PostgreSQL blocks UPDATE and DELETE on movements; corrections use attributable compensating movements.

MASS, VOLUME, and COUNT quantities normalize to G, ML, and PCS respectively. Unit conversion is permitted only within one dimension, COUNT is integral, and supported conversion code/dimension pairs are immutable. Packaged finished-good stock will be authoritative in pieces; cartons and loose pieces are calculated views and must not be stored as independent balances.

Active items cannot retain an inactive unit reference through supported application workflows. Unit deactivation is blocked while an active item references it, and item reactivation revalidates its active quantity masters. Item writes and these status transitions share Serializable PostgreSQL transactions with bounded conflict retry so concurrent requests cannot bypass the invariant.

All inventory outflows recheck the exact source bucket within the posting transaction and reject insufficient quantity. Warehouse transfers and status transfers create linked out/in movements in the same Serializable transaction, so half-transfers cannot commit. A warehouse cannot be deactivated while any of its ledger-derived buckets is nonzero, and an item's stock unit cannot change after movement history exists.

Goods receipt posting uses the inventory-owned transactional writer and atomically creates lots plus PURCHASE_RECEIPT movements in QUALITY_HOLD. QC decisions exactly reconcile each received canonical quantity and atomically move accepted stock to AVAILABLE and rejected stock to QUARANTINE. All movements preserve their lot reference. Posted GRN details, lots, and QC decisions are immutable at the database boundary.

Purchase returns can remove only server-derived purchased-lot stock from QUARANTINE. QC-rejected source entitlement and post-acceptance defect-quarantine entitlement are recorded separately so rejected goods are not subtracted twice from PO fulfilment. Posting rechecks exact lot/status stock and source entitlement within the same Serializable transaction that freezes the return and creates the negative PURCHASE_RETURN movement.

Supplier replacements are linked to purchase-return lines and reuse GRN QUALITY_HOLD posting plus QC classification. Only accepted replacement QC quantity satisfies the supplier obligation. PostgreSQL guards keep posted return and GRN replacement provenance immutable and reject mismatched replacement return/header/PO-line/item links.

## Posted transactions

Business transactions must support draft, posted, and cancelled/reversed lifecycles. Posted inventory or financial effects are corrected through compensating or reversal transactions, not destructive deletion.

An approved purchase order is a read-only commercial commitment, not a posted inventory or accounting transaction. PO creation/approval must not write inventory movements, received quantity, payables, journals, assets, or expenses. Draft header/line replacement and lifecycle transitions are atomic. Cancellation preserves the order and its actor, timestamp, and reason.

Sales Orders are commercial commitments. DRAFT orders have no stock effect; approval runs in a Serializable transaction that recomputes exact carton/piece pricing and validates each current AVAILABLE finished-good balance before posting paired AVAILABLE-out/RESERVED-in movements attributable to each Sales Order line. Any shortage aborts the complete approval. Cancellation preserves the order and writes the inverse RESERVED-out/AVAILABLE-in movements. Orders create no dispatch, customer balance, receivable, revenue, tax accounting, COGS, or physical inventory outflow.

Sales dispatches are immutable physical-custody documents once posted. A draft names exact finished-production lots, but the server owns FEFO eligibility, exact carton-to-PCS normalization, allocation reconciliation, production-lot AVAILABLE availability, and the source Sales Order line's own RESERVED entitlement. Posting atomically writes attributable paired RESERVED-out and IN_TRANSIT-in `SALES_DISPATCH` movements, preserving total company-custody quantity and production-lot provenance. Partial postings retain the undispatched order-line reservation; posted or delivered dispatches prevent normal Sales Order cancellation. Delivery confirmation records receipt metadata only and does not remove IN_TRANSIT stock, create an invoice, receivable, revenue, COGS, or accounting entry.

Sales invoices are created only from posted or delivered dispatch lines on one Sales Order. Draft quantities are exact carton/loose-piece normalization and must not exceed the dispatch line's posted quantity less its already POSTED invoice quantities; immutable dispatch-lot provenance is apportioned only from the remaining invoiceable allocation quantities. Draft invoices recalculate approved Sales Order commercial terms server-side and remain editable or cancellable, while POSTED invoices are immutable. In one Serializable transaction, posting rechecks source/lot reconciliation and IN_TRANSIT availability, writes negative `SALES_INVOICE_OUT` movements, creates one positive customer-receivable ledger entry, records the actor, and marks the invoice posted. Positive customer-ledger amounts are receivables; later payment/credit events will be negative. Customer outstanding is the signed ledger sum, not an editable customer field. COGS, inventory valuation, and General Ledger journals remain out of scope.

Customer payments have DRAFT, POSTED, and CANCELLED lifecycles. A posted payment atomically validates its customer, exact amount, and allocated posted invoices; creates one negative `CUSTOMER_PAYMENT` customer-ledger entry; and marks the receipt posted. Payment allocations separately settle invoice outstanding amounts, which are derived as invoice total less allocations belonging to POSTED payments. The full payment reduces customer exposure even when unallocated; that remainder is retained as on-account customer credit and may later be allocated from the same posted receipt. Payments create no inventory movement, sales revenue, tax, COGS, refund, or General Ledger event.

Sales returns use DRAFT, RECEIVED, INSPECTED, COMPLETED, and CANCELLED lifecycles. Receiving an invoiced return creates only positive `RETURN_INSPECTION` finished-good stock; receiving a pre-invoice dispatch refusal atomically transfers the exact attributable lot quantity from `IN_TRANSIT` to `RETURN_INSPECTION`. Inspection exactly reconciles every received line and atomically removes inspection custody while placing each lot-preserving quantity into AVAILABLE, QUARANTINE, REPROCESS, DAMAGED, or EXPIRED. A completed dispatch refusal reduces fulfilled quantity and reopens that exact quantity for redelivery, but it never silently recreates a reservation: an authorized manager must explicitly reserve current AVAILABLE stock in a separate serialized action. Only completed invoiced returns write one negative `SALES_RETURN_CREDIT` customer-ledger event recalculated from the immutable original invoice commercial terms. Invoice outstanding is derived as invoice total less posted payment allocations and completed return credits, never below zero; excess credit remains on the signed customer ledger. Returns do not reverse COGS, restore inventory value, create General Ledger entries, or pay refunds.

Goods receiving is a physical transaction but still has no payable or accounting effect. PO receipt progress is derived: pending QC counts posted/unclassified receipts, accepted fulfils the PO, and rejected does not. Receiving limits are rechecked inside Serializable posting transactions.

Purchase returns and supplier replacements are also physical-only transactions. Net PO fulfilment is derived from all QC-accepted receipts minus replacement-expected post-acceptance returns; accepted replacement receipts are already part of gross accepted and are never added twice. Returning original QC rejects changes custody only because those rejects never fulfilled the PO.

Recipes are versioned manufacturing master data and have no inventory effect. Standard batch, expected output, ingredients, and Packaging BOM quantities retain entered and normalized exact values. Ingredients reference RAW_MATERIAL items; packaging lines reference PACKAGING_MATERIAL items; recipe headers reference FINISHED_GOOD items through composite type-safe foreign keys.

Only DRAFT recipe aggregates may change. Approval revalidates active items/units, records the authenticated approver, inactivates the prior approved default for the finished good, and freezes the formula at both application and PostgreSQL boundaries. Later formulation changes create a new DRAFT version rather than overwriting history.

Production batches are stock-neutral plans tied permanently to one exact approved recipe version. DRAFT batches may recalculate their material and packaging requirement snapshots. PLANNED and RELEASED core plans and requirement rows are immutable at the PostgreSQL boundary; cancellation preserves actors, timestamps, reasons, and the frozen plan.

Batch availability is derived from current AVAILABLE ledger sums for the selected raw-material and packaging warehouses. Planning and release never create inventory movements or reservations. Release revalidates active recipe/warehouse references and requires explicit acknowledgement when any recommended issue quantity exceeds current availability.

Production material posting preserves supplier-lot identity and attributes every movement to the production batch and material transaction line. ISSUE is an atomic AVAILABLE-to-IN_PRODUCTION status transfer; RETURN is the inverse transfer to AVAILABLE; CONSUMPTION is a negative IN_PRODUCTION movement. The source and custody bucket is rechecked by item, warehouse, status, lot, and batch inside the Serializable posting transaction.

Only RAW_MATERIAL requirements from the frozen batch snapshot are eligible. Return and consumption cannot exceed the lot quantity still held by that batch. The first posted issue moves RELEASED to IN_PROGRESS in the same transaction, and any posted material movement prevents normal batch cancellation. Held quantity is always derived as issued minus returned minus consumed; consumed-minus-planned variance is informational and exact. Phase 12 creates no packaging, finished-goods, costing, or accounting effects.

Packaging transactions reuse the production transaction and central inventory authority with an explicit PACKAGING_MATERIAL class and frozen Packaging BOM requirement provenance. Only IN_PROGRESS batches are eligible. Packaging ISSUE and RETURN are paired AVAILABLE/IN_PRODUCTION movements, good CONSUMPTION is a negative IN_PRODUCTION movement, and DAMAGE is a paired IN_PRODUCTION-to-DAMAGED transfer with a required controlled reason.

The posting transaction rechecks exact lot-level AVAILABLE or batch-held IN_PRODUCTION quantity and preserves batch, transaction-line, supplier-lot, warehouse, canonical-unit, actor, and timestamp provenance. COUNT packaging normalizes only to whole pieces. Held packaging derives as issued minus returned minus good consumed minus damaged; total depleted is good consumed plus damaged. Provisional usage variance compares total depleted with the frozen planned standard and is not final output-based variance.

Production output is recorded through immutable posted documents. GOOD output enters AVAILABLE only as canonical PCS through `PRODUCTION_OUTPUT`; cartons and loose pieces are normalized input/display values. REPROCESS and REJECTED output use the finished product's MASS or VOLUME content basis and enter REPROCESS or SCRAP through distinct movement types. PROCESS_LOSS is an attributable normal/abnormal loss record and creates no positive inventory movement.

One immutable finished production lot per batch preserves product, recipe version, production/expiry dates, and the path from consumed supplier lots through the batch to finished output. First-lot creation and every output posting are serialized and atomic with their inventory effect. Stock balances are grouped by canonical unit so saleable PCS can never be added to bulk product-content quantities.

Yield and physical reconciliation use posted RAW_MATERIAL consumption only. Input components are aggregated only when every component matches the finished product-content dimension; MASS and VOLUME are never inferred across. Final Packaging BOM standards derive from cumulative posted GOOD pieces/full cartons and do not rewrite packaging history.

Batch completion recomputes custody and reconciliation in a Serializable transaction. It requires posted GOOD output, no output drafts, and zero IN_PRODUCTION balance independently for every item, warehouse, canonical unit, and lot. Incompatible or nonzero reconciliation and packaging mismatch require an explicit explanation. COMPLETED production plans, material/packaging transactions, output, and production lots are immutable through normal workflows.

## Atomicity and concurrency

Multi-record state changes use PostgreSQL transactions. Inventory posting uses Serializable isolation with bounded retry, server-side availability checks, and an optional unique source key per movement type to prepare for future idempotent business-event posting.

## Inventory valuation and production costing

Physical quantity and monetary value are separate linked ledgers. `InventoryMovement` remains authoritative for item, warehouse, status, and lot quantity. Phase 21 valuation entries are immutable, source-idempotent monetary events; their per-item balance is updated under a PostgreSQL row lock in the same Serializable transaction as each new ownership event.

The official Phase 21 method is company-wide per-item moving weighted average. Valued inbound changes quantity, value, and average; terminal outbound relieves value at the current average; internal location/status transfers do neither. All authoritative cost arithmetic uses `decimal.js` and database decimals. Zero quantity forces zero carrying value, and missing historical inbound basis is explicitly unresolved rather than treated as zero.

Posted GRNs use net commercial value after discount and before tax. Landed-cost and authorized correction records are monetary-only true-ups with immutable reasons and references. Actual production consumption transfers raw and packaging value into the batch. A finalized production snapshot is immutable, reconciles its exact cost pool to existing GOOD output movements, and supplies the lot cost entering finished-goods moving average. Sales outflow records later COGS basis, and invoiced return receipt restores the source sales-out basis. None of these events creates a General Ledger journal.

## Audit history

Important actions must ultimately record the acting user, timestamp, action, source transaction, and reason where required. Audit history is immutable. The audit engine and detailed retention policy belong to a later phase.
