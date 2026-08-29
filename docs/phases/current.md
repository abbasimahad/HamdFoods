# Current phase

## Phase 21 - Inventory Valuation & Production Costing

**Status:** COMPLETE

### Inventory valuation

- The official method is company-wide per-item `MOVING_WEIGHTED_AVERAGE`; warehouse, lot, and inventory-status transfers remain quantity-only internal movements.
- `InventoryMovement` remains authoritative for physical quantity. Immutable `InventoryValuationEntry` rows and their locked per-item balance become authoritative for inventory value, with exact six-decimal money and twelve-decimal unit-cost arithmetic.
- Valued inbound uses `(old value + inbound value) / (old quantity + inbound quantity)`. Outbound uses the current moving average; a zero quantity forces value and average to zero.
- Posted GRNs enter at net purchase value after line discounts and before tax. Supplier replacements restore the original commercial unit basis without a second supplier charge. Posted purchase returns leave at current moving-average cost.
- Posted landed-cost documents allocate by line value, compatible canonical quantity, or exact manual allocation and create monetary true-ups without changing quantity or rewriting the GRN.
- Future opening balances and adjustment-ins require an explicit unit cost. Historical inbound without reliable cost is marked `MISSING_VALUATION_BASIS` and may be resolved only through an authorized, attributable monetary initialization or adjustment.

### Production and sales cost basis

- Posted raw-material and good-packaging consumption leave inventory at the current moving average and transfer their exact value to the production batch. Issue, return, and packaging-damage status transfers do not change company-wide carrying value; damaged packaging exposure remains separately visible.
- Labor, machine, utilities, factory overhead, other direct cost, and explicit cost credits are immutable batch-level inputs after finalization. The cost pool is actual valued consumption plus additional cost less credits.
- Only a COMPLETED batch with resolved consumption, a production lot, positive actual GOOD output, and reconciled calculations may be finalized. Its immutable snapshot preserves actual pieces, cost pool, cost per piece, derived carton cost, user, timestamp, and calculation detail.
- Finalization attaches value to the existing production-output movements; it creates no duplicate stock. Batch unit cost enters the finished-good moving-average pool while the distinct production-lot cost remains preserved.
- `SALES_INVOICE_OUT` stores the moving-average monetary outflow for later COGS. An invoiced sales return restores the original sales-out unit basis; subsequent inspection classifications are internal and do not duplicate value.

### Backfill, routes, and deferred accounting

- Authorized rebuild processes supported historical ownership events by posting timestamp plus stable identifiers and unique source keys. Re-running unchanged history is idempotent. Unknown historical costs are visible rather than guessed.
- Routes: `/inventory/valuation`, `/inventory/valuation/[itemId]`, and `/production/batches/[id]/costing`.
- Migration: `20260830000000_phase21_inventory_valuation`.
- Phase 21 creates cost basis only. General Ledger, AP journals, COGS journals, revenue journals, P&L, Balance Sheet, and automated selling-price changes remain deferred to an explicitly scoped later phase.

## Next gate

Phase 22 may begin with a new approved scope. It must consume the immutable Phase 21 cost basis rather than create competing inventory-value truth.

Phase 21 verification passed Prettier formatting, ESLint, Vitest (12 files and 37 tests), Prisma validation/client generation, migration status, PostgreSQL connectivity, TypeScript, production build, live table/immutability-trigger inspection, and diff whitespace checks.
