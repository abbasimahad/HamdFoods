# Domain glossary

This records known vocabulary without defining schemas or workflows prematurely.

## Master data

- **Unit:** A named active/inactive measurement master with a MASS, VOLUME, or COUNT dimension. Phase 5 supports only KG/G, L/ML, and PCS unit codes; those supported codes and dimensions are immutable because they carry conversion meaning.
- **Item category:** A classification owned by exactly one item type. Items cannot use a category belonging to another type.
- **Item:** The unified master record for a raw material, packaging material, or finished good. Its code is a unique human-readable identifier, not its database primary key.
- **Packaging kind:** A packaging-only classification such as bottle, cap, label, carton, or seal.
- **Finished-good profile:** Product definition containing exact net content, its MASS/VOLUME unit, and pieces per carton. It describes the product and never represents stock.

Human-entered master codes are normalized to uppercase hyphenated form. Masters are deactivated rather than deleted so future historical references remain valid.

## Purchasing

- **Supplier:** An active/inactive purchasing counterparty identified by a database ID and unique human-readable supplier code. Deactivation prevents new commitments without removing history.
- **Purchase order:** A supplier commitment with a server-generated number and DRAFT, APPROVED, receiving-ready, CLOSED, or CANCELLED lifecycle. It has no physical inventory or accounting effect by itself.
- **Purchase-order line:** An order for one raw or packaging item that retains entered quantity, order unit, rate per selected unit, canonical quantity, discount/tax percentages, and exact calculated totals.
- **Ordered quantity:** Commercial intent recorded on a PO. It is distinct from physical received or available stock.

Draft purchase orders are editable. Approval revalidates active references and freezes the commitment; cancellation retains the order and records actor, time, and reason. Future receipt records will determine received and remaining quantities.

## Goods receiving and purchase QC

- **Goods receipt / GRN:** A PO-linked record of physical arrival at one warehouse. A draft has no stock effect; posting creates QUALITY_HOLD stock.
- **Pending QC:** Posted canonical receipt quantity not yet classified.
- **Accepted quantity:** QC-classified quantity moved from QUALITY_HOLD to AVAILABLE; it fulfils ordered quantity.
- **Rejected quantity:** QC-classified quantity moved from QUALITY_HOLD to QUARANTINE; it does not fulfil the PO and reopens remaining supply.
- **Inventory lot:** Immutable traceability identity connecting an item and supplier to one posted GRN line, optional supplier lot/manufacture/expiry data, and all resulting inventory movements.
- **Remaining to receive now:** Ordered minus accepted minus pending QC.
- **Remaining to fulfil:** Ordered minus accepted.

QC must classify every line exactly: accepted plus rejected equals received. Supplier lot numbers remain null when not supplied.

## Purchase returns and supplier replacements

- **Purchase return:** A supplier-linked document that removes eligible purchased-lot stock from QUARANTINE when posted. It retains the original PO, GRN, GRN line, inventory lot, warehouse, reason, and actor chain.
- **QC-rejected return source:** Original QC-rejected lot quantity still held in QUARANTINE. Returning it changes physical custody but not accepted PO fulfilment.
- **Post-acceptance defect quarantine:** A recorded, lot-preserving AVAILABLE-to-QUARANTINE transfer for purchased material found defective after QC acceptance.
- **Replacement required:** Canonical returned quantity explicitly marked as owed by the supplier.
- **Replacement accepted:** Canonical quantity on linked replacement GRNs that completed QC into AVAILABLE. Replacement rejects do not count.
- **Replacement remaining:** Replacement required minus replacement accepted, never below zero.
- **Net accepted fulfilment:** Cumulative QC-accepted GRN quantity, including accepted replacements, minus replacement-expected post-acceptance return quantity. It is derived rather than stored.

Supplier replacements are free physical receipts against an existing return obligation. They reuse GRN and QC, retain original PO commercial totals, and create no payable or accounting effect in Phase 9.

## Recipes, formulations, and Packaging BOMs

- **Recipe / formulation:** A versioned manufacturing master for one finished good, expressed on an exact standard-batch basis and containing raw-material ingredient lines.
- **Recipe version:** An immutable approved or inactive snapshot identified by stable recipe code plus positive version number. Formula changes create a new DRAFT version.
- **Standard batch:** Positive entered quantity/unit and normalized canonical quantity used as the denominator for exact scaling.
- **Expected output:** Optional planned good output. Expected yield percent is derived only when its dimension matches the standard batch.
- **Ingredient allowance:** Nonnegative planning percentage applied after scaling; standard net requirement and recommended issue remain separate.
- **Packaging BOM:** Version-owned list of packaging-material quantities used PER_PIECE or PER_CARTON.
- **Packaging allowance:** Planning percentage kept separate from the standard packaging requirement. COUNT recommendations round upward to whole pieces.

Recipe scaling and packaging calculations describe future requirements only. They do not reserve, issue, consume, produce, value, or otherwise move inventory.

## Production planning

- **Production batch:** A numbered, stock-neutral plan permanently tied to one approved Recipe ID/version and matching finished good.
- **Material requirement snapshot:** The recipe-line source, standard quantity, scaled planned quantity, allowance, recommended issue, item, and canonical unit frozen when a batch becomes PLANNED.
- **Packaging requirement snapshot:** The Packaging BOM-line source, usage basis, standard requirement, allowance, recommended issue, item, and canonical unit frozen with the plan.
- **Planned expected output:** The approved recipe's expected output scaled by the exact planned-batch factor; it is not actual yield or finished-goods stock.
- **Planned product content:** Finished-good per-piece net content multiplied by canonical planned pieces. Its signed comparison with expected output is informational and has no invented tolerance threshold.
- **Production availability:** Current AVAILABLE ledger quantity for a requirement item in its selected source warehouse. Shortage/surplus compares availability with recommended issue and never reserves stock.

A DRAFT batch can be recalculated. PLANNED freezes its snapshots, RELEASED makes it eligible for later material issue, and eligible batches are cancelled rather than deleted. Phase 11 lifecycle actions have zero inventory and accounting effect.

## Production material control

- **Production material transaction:** A batch-linked ISSUE, RETURN, or CONSUMPTION document with a DRAFT, POSTED, or CANCELLED lifecycle. MI, MR, and MC document numbers are generated by the server.
- **IN_PRODUCTION custody:** Physical raw material issued to one production batch while retaining its warehouse, item, canonical unit, and supplier-lot traceability. It is a stock status, not a monetary WIP valuation.
- **Material issue:** An atomic transfer of a selected lot from AVAILABLE to the issuing batch's IN_PRODUCTION custody.
- **Material return:** An atomic transfer from the batch's lot-specific IN_PRODUCTION custody back to AVAILABLE.
- **Material consumption:** A lot-specific removal from the issuing batch's IN_PRODUCTION custody representing actual raw-material use.
- **Held quantity:** Posted issued quantity minus posted returned quantity minus posted consumed quantity for the batch requirement.
- **Consumption variance:** Actual consumed canonical quantity minus the frozen planned canonical quantity, reported as OVER, UNDER, or EXACT.

Multiple issues may satisfy one frozen raw-material requirement. Posting above the remaining plan is allowed with an explicit warning and remains visible in reconciliation. Phase 12 does not issue packaging or create finished goods, costing, WIP value, or accounting entries.

## Production packaging control

- **Packaging transaction:** A PI/PR/PC/PD-numbered ISSUE, RETURN, good CONSUMPTION, or DAMAGE document for one frozen Packaging BOM requirement and selected inventory lot.
- **Good packaging consumption:** Packaging successfully depleted in packing. It remains distinct from production damage and does not itself create finished goods.
- **Packaging damage:** A controlled BROKEN, CRUSHED, TORN, MACHINE_SETUP, PRINT_DEFECT, FILLING_DAMAGE, HANDLING_DAMAGE, or OTHER event that transfers batch-held packaging into DAMAGED custody without destroying it.
- **Packaging held quantity:** Issued minus returned minus good consumed minus damaged for the batch requirement.
- **Total packaging depleted:** Good consumed plus damaged.
- **Provisional packaging variance:** Total depleted minus the frozen planned standard requirement. It remains provisional until actual finished output exists.
- **Good-consumption variance:** Good consumption minus planned standard, displayed separately so damage is not hidden inside successful packaging use.

Planned standard, allowance, recommended issue, actual good consumption, and damage remain separate quantities. Additional issues and multiple supplier lots are retained as independent history.

## Production output and completion

- **Production output transaction:** A PO-numbered GOOD, REPROCESS, REJECTED, or PROCESS_LOSS document with a DRAFT, POSTED, or CANCELLED lifecycle. Posted output is immutable.
- **Good output:** Saleable finished production normalized from cartons and loose pieces to authoritative PCS and received into AVAILABLE stock.
- **Production lot:** The immutable finished-product traceability identity for one batch, finished good, recipe version, production date, and optional expiry date.
- **Reprocess output:** Recoverable bulk product held in REPROCESS status on the finished product's MASS or VOLUME content basis. It is not normal saleable finished stock.
- **Rejected output:** Irrecoverable recorded product held in SCRAP status and excluded from saleable stock.
- **Process loss:** Product that physically disappeared or cannot be recovered. It records a controlled reason and NORMAL/ABNORMAL nature without creating positive inventory.
- **Actual raw input:** Posted raw-material consumption grouped by canonical dimension; issued, returned, and packaging quantities are excluded.
- **Good yield:** Exact good product content divided by compatible actual raw input.
- **Recoverable yield:** Exact good plus reprocess content divided by compatible actual raw input.
- **Total accounted output:** Good content plus reprocess, rejected output, and process loss on one compatible basis.
- **Unreconciled difference:** Compatible actual raw input minus total accounted output. It is never silently discarded.
- **Final packaging standard:** Packaging BOM quantity recalculated from cumulative actual GOOD pieces or full cartons. It coexists with the frozen planned standard.
- **Completed batch:** An immutable physical-production record with posted GOOD output, no drafts, zero batch-held custody in every inventory bucket, completion actor/time, and any required reconciliation explanation.

Supplier-lot lineage is resolved through posted raw consumption movements to the production batch and its production lot; source history is referenced rather than copied.

## Inventory and warehouses

- **Warehouse:** An active/inactive stock location master. Historical warehouses are retained rather than deleted.
- **Inventory movement:** An immutable signed canonical quantity entering or leaving one item, warehouse, and status bucket. It records its type, reference, actor, timestamp, and reason.
- **Inventory status:** One of AVAILABLE, RESERVED, QUALITY_HOLD, QUARANTINE, REPROCESS, DAMAGED, EXPIRED, SCRAP, IN_TRANSIT, or IN_PRODUCTION. Only AVAILABLE is normal usable stock; IN_PRODUCTION is physical batch custody.
- **Stock balance:** A derived sum of signed movements for an item, warehouse, and status. It is not an editable stored master value.
- **Warehouse transfer:** One atomic operation containing linked TRANSFER_OUT and TRANSFER_IN movements.
- **Status transfer:** One atomic operation containing linked STATUS_OUT and STATUS_IN movements within a warehouse.

Inventory includes raw materials, packaging materials, and finished goods. Future workflows may add work in progress. Every physical quantity has a traceable warehouse, status, canonical unit, source/reference, actor, and transaction history; costing remains a later concern.

## Finished-goods quantity

Packaged finished goods use the smallest sellable piece as the canonical quantity. Cartons and loose pieces are normalized views of one piece quantity, never separate authoritative balances.

Example: for 24 bottles per carton, 10 cartons plus 7 loose bottles equals 247 pieces.

Loose pieces normalize automatically: 2 cartons plus 30 loose at 24 pieces per carton becomes 3 cartons plus 6 loose, while the canonical result remains 78 pieces. A sealed-carton requirement is a separate explicit ceiling calculation and is not applied globally.

## Canonical measurement quantity

- **Canonical mass:** grams (`G`).
- **Canonical volume:** millilitres (`ML`).
- **Canonical count:** pieces (`PCS`).
- **Quantity conversion:** exact conversion between compatible supported units, driven by Unit master code and dimension.
- **Finished-good content:** exact per-piece net content multiplied by a piece quantity. Carton content is a derived instance of this rule.

Display formatting may show 2500 g as 2.5 kg or 1250 ml as 1.25 L when the corresponding active display unit exists. Formatting never modifies a canonical value.

COUNT quantities are whole integers. A finished good uses the active PCS/COUNT master as its stock unit even though its per-piece product content is measured in MASS or VOLUME.

## Transaction states

- **Draft:** editable, not yet authoritative for posted stock or financial effects.
- **Posted:** accepted and effect-bearing; never destructively deleted.
- **Cancelled/reversed:** neutralized through an attributable compensating action.

Detailed state transitions remain domain decisions for the phase that introduces each transaction type.
