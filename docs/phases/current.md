# Current phase

## Phase 14 - Finished Output, Yield, Reprocess & Batch Completion

**Status:** COMPLETE

### Output and inventory

- IN_PROGRESS batches accept DRAFT GOOD, REPROCESS, REJECTED, and PROCESS_LOSS documents with server-generated PO numbers. Only drafts may change or be cancelled; posted history is immutable and attributable.
- GOOD posting normalizes cartons and loose pieces through the carton engine and writes only canonical PCS to AVAILABLE with `PRODUCTION_OUTPUT`. Multiple postings accumulate from the ledger and display as one normalized carton/loose view.
- REPROCESS and REJECTED post exact product-content quantities to REPROCESS and SCRAP with distinct movement types. PROCESS_LOSS retains controlled normal/abnormal classification and reason but creates no positive stock.
- One immutable production lot per batch records the finished good, recipe version, production date, optional expiry, and batch identity. Output movements preserve batch, output-document, production-lot, actor, and timestamp provenance.

### Reconciliation, yield, and packaging

- Actual input is derived only from posted RAW_MATERIAL consumption. Compatible input, good content, reprocess, rejected output, and process loss produce exact accounted output and unreconciled difference.
- Good yield is `good output / actual input`; recoverable yield adds reprocess; process-loss percent uses process loss alone. Expected-versus-actual yield is reported in percentage points. MASS and VOLUME are never implicitly converted, and incompatible component bases remain visible without a fabricated yield.
- Final Packaging BOM standards use cumulative posted good pieces for PER_PIECE lines and normalized full cartons for PER_CARTON lines. Planned variance remains visible beside final total-depleted and good-consumption variances, including output/packaging consistency warnings.

### Completion and authorization

- `production.view` protects the output, yield, packaging, and lineage view. `production.manage` is resolved server-side for draft creation/editing, posting, cancellation, loss/reprocess recording, and completion; acting user IDs never come from the browser.
- Completion recomputes all facts in a Serializable transaction. It requires IN_PROGRESS status, posted GOOD output, no output drafts, and zero IN_PRODUCTION balance for every item/warehouse/unit/lot custody bucket. Incompatible or nonzero reconciliation and packaging mismatches require an explicit explanation.
- COMPLETED records the actor and timestamp and is read-only for normal material, packaging, output, and plan operations. The summary retains the recipe/version, raw and packaging actuals, finished and other output, yields, production lot, and consumed supplier lots.

### Routes, migrations, and scope

- Routes: `/production/batches/[id]/output` and `/production/batches/[id]/output/[transactionId]/edit`.
- Migrations: `20260823240000_phase14_production_output`, `20260823241000_phase14_output_integrity_guards`, `20260823242000_phase14_completion_custody_guard`, and `20260823243000_phase14_output_quantity_guards`. The repository has 21 applied migrations.
- Phase 14 creates physical quantity and traceability effects only. It adds no costing, valuation, accounting, sales, reprocess reuse, PWA, or deployment behavior.
- Verification used only permitted implementation checks. Automated tests and aggregate commands that execute tests were neither created nor run.

## Next gate

Phase 15 may build on completed, immutable physical batch history. Its scope must be defined explicitly; costing, accounting, sales, and reprocess reuse remain excluded until a later approved phase introduces them.
