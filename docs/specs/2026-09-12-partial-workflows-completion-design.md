# Reprocess and Waste & Damage Completion Design

**Date:** 2026-09-12
**Baseline:** `c8f0dbfe0860937a4b74c45f94095b571a6fed68`
**Scope:** Turn only the two current `PARTIAL` workflows into `COMPLETE`. Purchase Invoices and Administration Settings remain `MISSING`; Phase 33 remains unstarted.

## Shared authority

- PostgreSQL records and the append-only inventory ledger remain the physical source of truth.
- Posted inventory, valuation, accounting, QC, and genealogy records are immutable. Corrections use explicit compensating records and are rejected when downstream activity makes reversal unsafe.
- Every quantity and value calculation uses `Decimal`; calendar-day expiry uses date-only arithmetic.
- Server application services enforce lifecycle, permission, segregation-of-duties, lot/status balance, duplicate-posting, period-close, and downstream-dependency rules. UI visibility is not an authority.
- Existing production material, packaging, output, costing, valuation, accounting, audit, purchase-return, and sales-return engines remain authoritative. The new workflows orchestrate or extend them narrowly; they do not duplicate them.
- Mutation tests use only the disposable test database.

## Partial workflow 1: Reprocess

### CURRENT

- `/production/reprocess` is a planned navigation target with no route or workbench.
- Production output supports immutable DRAFT/POSTED/CANCELLED `REPROCESS` output. Posting creates traceable positive `REPROCESS` inventory in the finished good's MASS/VOLUME content unit and links it to the originating production lot and batch.
- Sales-return inspection can move an original finished-goods production lot into `REPROCESS` while retaining lot provenance.
- A normal production batch already owns recipe/BOM snapshots, material and packaging issue/return/consumption, output/yield, WIP costing, valuation, accounting, and completion.
- GOOD normal output enters `AVAILABLE`; the one production lot per batch has production/expiry dates but no parent/reprocess genealogy or finished-output QC record.
- Production operations require `production.manage`. There is no `quality.manage` permission or finished-output release authority.
- Existing batch costing values only GOOD output. Source reprocess consumption, recoverable-output carrying value, independent QC release, and child-lot genealogy are absent.
- Posted production transactions are immutable; drafts may be edited/cancelled. There is no safe reprocess reservation/start reversal or QC reversal.

### MISSING

- **UI:** dedicated list/new/detail/edit/QC pages and permission-safe lifecycle actions.
- **Application/service:** eligibility, reservation, start, exact source-output reconciliation, policy snapshot, independent QC, and genealogy queries.
- **Repository:** a Reprocess aggregate orchestrating exactly one explicitly classified linked batch.
- **Schema:** document/source contribution, batch classification/link, child genealogy, shelf-life policy/snapshot, QC, lifecycle, movement linkage, numbering, and database guards.
- **Accounting/valuation:** authoritative source carrying-value consumption into WIP and recoverable reprocess-output valuation without duplicate production journals.
- **Inventory:** lot-specific REPROCESS reservation, WIP transfer/consumption, reprocess GOOD to QUALITY_HOLD, and QC status movements.
- **Lifecycle/status:** DRAFT → RESERVED → IN_PROGRESS → AWAITING_QC → RELEASED or REJECTED, plus safe pre-processing cancellation/compensation.
- **Reporting/history:** bidirectional source/document/batch/child/QC/cost traceability.

### IMPLEMENT

#### Product and recipe policy

- Add nullable `FinishedGoodProfile.reprocessShelfLifeDays` with a database positive-integer check and a conservative application upper bound. Existing products remain valid; no value is guessed or backfilled.
- Expose the field in the existing finished-good master form. `inventory.manage` remains the product-master authority.
- Operators cannot enter shelf-life days on a Reprocess document.
- A Reprocess document selects an approved recipe for the same finished good. Its linked `ProductionBatch` is explicitly `REPROCESS`; normal batches are explicitly `NORMAL`. Recipe/BOM execution itself is unchanged.

#### Aggregate and lifecycle

- Add one `ReprocessDocument` with a unique document number and one unique linked `ProductionBatch`.
- Model source genealogy through a contribution relation even though this delivery permits exactly one source lot per document. This leaves future multi-source genealogy representable without changing current rules.
- DRAFT creation snapshots source lot identity/provenance, source status/unit, requested quantity, source expiry, effective shelf-life policy, recipe, warehouses, reason, initiator, and dates. It creates exactly one linked DRAFT REPROCESS batch but posts no inventory.
- Reserve only from positive, unexpired, lot-specific `REPROCESS` custody. Reservation atomically moves the exact selected quantity to controlled reserved custody and prevents double use. Cancelling DRAFT/RESERVED cancels the untouched linked batch and, when reserved, posts the exact compensating release.
- Start atomically moves the reserved source into linked-batch `IN_PRODUCTION` custody, starts the linked batch, and records the source contribution. A pre-activity start reversal is allowed only while the linked batch has no material, packaging, output, cost, or downstream activity; otherwise it is rejected.
- Once physical processing activity exists, cancellation or destructive reversal is unavailable. Existing immutable linked-batch transaction rules apply.
- Additional ingredients/additives/packaging and other supported costs use only the linked batch's existing engines.

#### Quantity, lot, and dates

- Normalize source COUNT quantities to the finished good's product-content basis using the frozen net-content conversion; content-unit sources remain exact compatible MASS/VOLUME quantities.
- Source content consumed must equal GOOD content + REJECTED/SCRAP content + documented PROCESS_LOSS. Reprocess output from the linked batch is not an allowed unexplained remainder at completion; another cycle requires a later document.
- Completion is one Serializable orchestration that rechecks source consumption and linked-batch output reconciliation, completes the batch, snapshots completion date and yield, and leaves all source history unchanged.
- GOOD output uses the existing output transaction and creates the linked batch's new child `ProductionLot`. The child is linked through output → REPROCESS batch → Reprocess document → source contribution/lot.
- For a reprocess batch only, GOOD initially posts to `QUALITY_HOLD`, never directly to `AVAILABLE`.
- At completion, calculate and persist:
  - `policyExpiry = completionDate + snapshotted reprocessShelfLifeDays`
  - `childExpiry = min(sourceExpirySnapshot, policyExpiry)`
- The child lot receives its own completion/production date and immutable calculated expiry. Later product-policy edits never recalculate it.

#### Costing and accounting

- Extend the existing production valuation authority so recoverable REPROCESS output receives a documented valuation-equivalent basis using the finished-good net-content conversion. Ordinary batches with no reprocess output retain their current result.
- Keep the finalized batch's total finished-goods capitalization unchanged: allocate the same finished-goods cost pool across GOOD plus recoverable REPROCESS-equivalent output; rejected output and process loss do not create owned recoverable value.
- At Reprocess start/consumption, the existing valuation authority derecognizes the exact reserved source layer/value and posts it to the linked batch's WIP. Missing valuation basis blocks costing; a genuine zero carrying value remains zero.
- Linked-batch costing adds that source value to existing raw-material, packaging, and additional costs, then values the child GOOD output through the existing production-output finalization path.
- Reprocess orchestration does not recreate material-consumption, WIP, or final-output journals. Source keys and uniqueness checks prove every physical/value/accounting effect occurs once.
- QC release requires finalized linked-batch costing so AVAILABLE child stock cannot be released with unresolved basis.

#### Quality authority

- Add `quality.manage` through existing RBAC seeding/migration. It is included through normal all-permission SUPER_ADMIN/ADMIN seeding and is not granted to ordinary production roles. Existing purchasing QC authorization is unchanged.
- `production.manage` creates, reserves, starts, records linked production, and completes Reprocess. It cannot perform QC/release.
- A separate immutable QC record stores document, child lot, APPROVED/REJECTED, structured rejection reason when applicable, notes, inspector, and timestamp.
- Server-side segregation requires the inspector to differ from both initiator and completer, with no SUPER_ADMIN bypass.
- APPROVED atomically moves the child lot from QUALITY_HOLD to AVAILABLE. REJECTED atomically moves it from QUALITY_HOLD to QUARANTINE. Both preserve the production lot and post audit events.
- Read access is allowed to `production.view` or `quality.manage`; mutation commands still require their exact permissions. Navigation supports this any-of visibility without widening other routes.

#### UI and audit

- Activate `/production/reprocess` with searchable/filterable list and `+ New Reprocess`.
- Add new/edit/detail and `/production/reprocess/[id]/qc` pages using existing form controls, searchable selectors, pending/duplicate-submit protection, Save/Cancel patterns, and lifecycle action components.
- The detail page shows source provenance, policy snapshot/calculation, reservation/consumption, linked batch and its existing material/packaging/output/cost pages, reconciliation/yield, child lot, QC, actors/timestamps, and audit history.
- QC is read-only apart from Approve & Release / Reject. A self-reviewing initiator/completer sees and receives: “Another authorized quality user must review this reprocess result.”
- Audit CREATE, reservation/RELEASE, start/POST, completion, child creation, QC decision, inventory status movement, cancellation, safe compensation, actor IDs, quantities, dates, and all genealogy references.

### DO NOT CHANGE

- Do not make ordinary batch GOOD output wait for reprocess QC.
- Do not put recovered GOOD into the original lot or overwrite original dates.
- Do not add a separate reprocess material, packaging, output, costing, valuation, or accounting engine.
- Do not permit direct AVAILABLE sourcing; Waste & Damage first establishes eligible REPROCESS custody.
- Do not support multiple source lots in this first UI/service, operator expiry overrides, self-approval, silent admin bypass, editable posted genealogy, or a laboratory/LIMS subsystem.

### ACCEPTANCE

- The 25 approved Reprocess tests are implemented, including one-to-one batch classification, reservation concurrency, exact consumption/output balance, existing linked-batch engines, no duplicate accounting, new QUALITY_HOLD child lot, frozen expiry, bidirectional genealogy, independent QC release/rejection, immutable history, and direct-action denial.
- Additional tests prove NULL policy compatibility, both expiry-minimum cases, source-expiry requirement, policy-history stability, zero versus missing valuation basis, and ordinary NORMAL batch behavior.
- Focused unit, disposable-DB integration, and browser E2E cover DRAFT → RESERVED → IN_PROGRESS → AWAITING_QC → RELEASED and REJECTED.

## Partial workflow 2: Waste & Damage

### CURRENT

- `/production/waste-damage` is a planned navigation target with no route or workbench.
- Packaging DAMAGE transfers lot-specific `IN_PRODUCTION` quantity to `DAMAGED` and records a controlled reason.
- Production REJECTED output creates lot-specific `SCRAP`; PROCESS_LOSS is a classified quantity record with no positive inventory.
- Sales-return inspection can place original production lots into `DAMAGED` or `QUARANTINE`.
- Generic inventory status transfer can move aggregate status balances, but it is immediate, is not a disposition document, lacks required lot provenance/downstream controls, and has no draft/cancel/reversal lifecycle.
- Existing valuation is authoritative for carrying value; accounting has inventory asset and variance mappings but no dedicated final write-off source/document.
- Production damage uses `production.manage`; controlled inventory corrections use `inventory.manage`.

### MISSING

- **UI:** dedicated workbench, draft line editor, detail/history, posting, cancellation, and reversal actions.
- **Application/service:** action/status matrix, shared Reprocess eligibility, reason policy, lot-level availability, dependency-aware reversal, and duplicate-loss detection.
- **Repository:** a disposition header/line aggregate and authoritative posting orchestration.
- **Schema:** document/line/status/action/reason/sequence, movement/valuation/accounting references, reversal links, and immutability guards.
- **Accounting/valuation:** automatic final WRITE_OFF derecognition/loss and exact compensating reversal.
- **Inventory:** lot-specific controlled status pairs and final outbound write-off movement.
- **Lifecycle/status:** editable DRAFT → POSTED or CANCELLED, plus explicit safe reversal.
- **Reporting/history:** lot provenance, movement/value/journal, reversal, and downstream Reprocess links.

### IMPLEMENT

#### Aggregate and rules

- Add `WasteDisposition` DRAFT/POSTED/CANCELLED/REVERSED header and ordered lines. Each line freezes item, one inventory or production lot, warehouse, source status, exact quantity/unit, action, structured reason, notes, and provenance.
- Actions are exactly:
  - `MOVE_TO_SCRAP`: DAMAGED or QUARANTINE → SCRAP.
  - `MOVE_TO_REPROCESS`: eligible FINISHED_GOOD in DAMAGED or QUARANTINE → REPROCESS.
  - `WRITE_OFF`: DAMAGED or SCRAP → permanent negative owned inventory.
- Reasons are DAMAGED, EXPIRED, SPOILED, CONTAMINATED, PACKAGING_DAMAGE, PRODUCTION_LOSS, QUALITY_REJECT, HANDLING_DAMAGE, OTHER; OTHER requires notes. Action remains independent from reason.
- `inventory.manage` is the existing narrow inventory-control authority for create/edit/post/cancel/reverse. `production.manage` alone does not grant disposition or write-off authority. `inventory.view` can read.
- Posting is Serializable and rechecks active item/warehouse, exact lot/status/unit balance, positive quantity, no duplicate source-line posting, and the action/status matrix.
- MOVE_TO_REPROCESS calls the same shared eligibility policy as Reprocess: finished good, traceable source production lot, unexpired authoritative expiry, configured shelf-life policy, and sufficient exact custody. It creates no Reprocess document, batch, child output, QC, valuation loss, or accounting loss.

#### Inventory, value, and accounting

- MOVE_TO_SCRAP and MOVE_TO_REPROCESS post exact paired immutable status movements and retain owned inventory/value.
- WRITE_OFF posts one exact lot/status-specific outbound movement. There is no WRITTEN_OFF balance bucket.
- The existing valuation authority determines carrying value; operators cannot provide value. Missing basis blocks a valued write-off for correction, while authoritative zero value permits the quantity posting with no fake journal amount.
- Add the narrow accounting mapping/source needed for inventory loss: debit configured inventory loss/waste expense and credit the item-type inventory asset. Zero-value write-off creates no zero-value journal.
- Posting detects prior source-event loss recognition and unique source keys prevent duplicate valuation or journal effects.
- MOVE_TO_SCRAP and MOVE_TO_REPROCESS never post write-off valuation/accounting.

#### Cancellation and reversal

- DRAFT is editable and cancellable with no inventory/value/accounting effects; CANCELLED is immutable.
- POSTED documents are immutable. Reversal creates a linked compensating disposition and movements; it never edits the original.
- MOVE_TO_SCRAP reversal returns SCRAP to its original status only when the exact lot quantity remains and no later disposition/reprocess consumes it.
- MOVE_TO_REPROCESS reversal returns REPROCESS to its original status only when no Reprocess reservation/document/start or later disposition uses it.
- WRITE_OFF reversal restores the exact original quantity and snapshotted valuation, and reverses the original accounting through existing open-period controls. Closed-period or other unsafe reversal is rejected clearly.

#### UI, history, and audit

- Activate `/production/waste-damage` with filters and `+ New Disposition`; add new/edit/detail routes.
- Reuse shared searchable item/lot selectors, line editor (`+ Add Item`, Remove), pending and duplicate-submit protection, validation summary, Save Draft, Cancel, Post, and Reverse patterns.
- The detail page shows immutable lines, source provenance, movements, valuation and journal references, actors/timestamps, reversal, and any later Reprocess document/batch/child/QC link.
- Audit creation/update/post/cancel/reverse and per-line action, reason, lot, source/destination status, quantities, valuation/journal IDs, downstream links, actors, and timestamps.

### DO NOT CHANGE

- Do not add supplier return, salvage, donation, destruction certificates, arbitrary status editing, production execution, consumption, or direct balances.
- Do not make SCRAP a final derecognition event or recognize loss before WRITE_OFF.
- Do not let Waste & Damage create a child lot, perform QC, or execute Reprocess.
- Do not duplicate Purchase Returns or allow a supplier-return path here.

### ACCEPTANCE

- The 27 approved Waste & Damage tests are implemented: the full action/status matrix, shared Reprocess eligibility, exact lot balances, owned-inventory behavior, authoritative write-off value and balanced accounting, no duplicate loss, immutability, cancellation, safe compensating reversals, downstream reversal blocks, genealogy, audit, permissions, and direct-action protection.
- Focused unit, disposable-DB integration, and browser E2E cover DRAFT → POSTED, DRAFT → CANCELLED, and each safe/blocked reversal path.

## Delivery order and final evidence

1. Implement and fully verify Reprocess before changing Waste & Damage behavior.
2. Implement and fully verify Waste & Damage.
3. Run the required full unit, traced integration, zero-retry E2E, `pnpm verify`, and `git diff --check` gates; inspect server/browser logs and concurrent-query warnings.
4. Update workflow inventory/current phase/progress only after evidence supports `PARTIAL: 0`, `MISSING: 2`.
5. Perform read-only production health/listener/PostgreSQL/auth-bypass/business-data checks, using only the established maintenance stop/start if a Windows build lock requires it.
6. Review the complete diff and source/secret hygiene, commit legitimate scope, push normally, fetch, and prove clean `HEAD == origin/main`.
