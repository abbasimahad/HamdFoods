CREATE TYPE "InventoryValuationMethod" AS ENUM ('MOVING_WEIGHTED_AVERAGE');
CREATE TYPE "InventoryValuationEntryType" AS ENUM ('OPENING_BALANCE', 'ADJUSTMENT_IN', 'ADJUSTMENT_OUT', 'PURCHASE_RECEIPT', 'SUPPLIER_REPLACEMENT', 'PURCHASE_RETURN', 'LANDED_COST', 'PRODUCTION_CONSUMPTION', 'PACKAGING_CONSUMPTION', 'PRODUCTION_OUTPUT', 'SALES_OUT', 'SALES_RETURN', 'VALUATION_INITIALIZATION', 'COST_ADJUSTMENT');
CREATE TYPE "InventoryValuationState" AS ENUM ('FINAL', 'PROVISIONAL', 'MISSING_VALUATION_BASIS');
CREATE TYPE "LandedCostStatus" AS ENUM ('DRAFT', 'POSTED', 'CANCELLED');
CREATE TYPE "LandedCostAllocationMethod" AS ENUM ('BY_LINE_VALUE', 'BY_QUANTITY', 'MANUAL');
CREATE TYPE "ProductionCostCategory" AS ENUM ('DIRECT_LABOR', 'MACHINE', 'UTILITIES', 'FACTORY_OVERHEAD', 'OTHER_DIRECT', 'COST_CREDIT');
CREATE TYPE "BatchCostingStatus" AS ENUM ('UNCOSTED', 'PROVISIONAL', 'FINALIZED');

CREATE TABLE "inventory_valuation_balance" (
  "itemId" TEXT PRIMARY KEY,
  "valuationMethod" "InventoryValuationMethod" NOT NULL DEFAULT 'MOVING_WEIGHTED_AVERAGE',
  "ownedQuantity" DECIMAL(24,6) NOT NULL DEFAULT 0,
  "inventoryValue" DECIMAL(30,6) NOT NULL DEFAULT 0,
  "averageUnitCost" DECIMAL(30,12),
  "missingBasisCount" INTEGER NOT NULL DEFAULT 0,
  "lastValuationAt" TIMESTAMP(3),
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "inventory_valuation_balance_nonnegative_check" CHECK ("ownedQuantity" >= 0 AND "inventoryValue" >= 0 AND "missingBasisCount" >= 0),
  CONSTRAINT "inventory_valuation_balance_average_check" CHECK ("averageUnitCost" IS NULL OR "averageUnitCost" >= 0)
);

CREATE TABLE "inventory_valuation_entry" (
  "id" TEXT PRIMARY KEY,
  "sourceKey" TEXT NOT NULL UNIQUE,
  "itemId" TEXT NOT NULL,
  "inventoryMovementId" TEXT UNIQUE,
  "entryType" "InventoryValuationEntryType" NOT NULL,
  "state" "InventoryValuationState" NOT NULL DEFAULT 'FINAL',
  "valuationMethod" "InventoryValuationMethod" NOT NULL DEFAULT 'MOVING_WEIGHTED_AVERAGE',
  "effectiveAt" TIMESTAMP(3) NOT NULL,
  "quantityEffect" DECIMAL(24,6) NOT NULL,
  "unitCost" DECIMAL(30,12),
  "valueDelta" DECIMAL(30,6),
  "runningOwnedQuantity" DECIMAL(24,6) NOT NULL,
  "runningInventoryValue" DECIMAL(30,6) NOT NULL,
  "resultingAverageUnitCost" DECIMAL(30,12),
  "sourceType" TEXT NOT NULL,
  "sourceId" TEXT,
  "sourceNumber" TEXT,
  "productionBatchId" TEXT,
  "inventoryLotId" TEXT,
  "productionLotId" TEXT,
  "notes" TEXT,
  "createdByUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "inventory_valuation_entry_running_check" CHECK ("runningOwnedQuantity" >= 0 AND "runningInventoryValue" >= 0),
  CONSTRAINT "inventory_valuation_entry_cost_check" CHECK ("unitCost" IS NULL OR "unitCost" >= 0),
  CONSTRAINT "inventory_valuation_entry_missing_check" CHECK (("state" = 'MISSING_VALUATION_BASIS' AND "valueDelta" IS NULL AND "resultingAverageUnitCost" IS NULL) OR "state" <> 'MISSING_VALUATION_BASIS')
);

CREATE TABLE "inventory_valuation_adjustment" (
  "id" TEXT PRIMARY KEY,
  "number" TEXT NOT NULL UNIQUE,
  "itemId" TEXT NOT NULL,
  "valueDelta" DECIMAL(30,6) NOT NULL,
  "reason" TEXT NOT NULL,
  "reference" TEXT,
  "createdByUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "inventory_valuation_adjustment_nonzero_check" CHECK ("valueDelta" <> 0)
);

CREATE TABLE "inventory_valuation_issue" (
  "id" TEXT PRIMARY KEY,
  "sourceKey" TEXT NOT NULL UNIQUE,
  "itemId" TEXT NOT NULL,
  "inventoryMovementId" TEXT UNIQUE,
  "quantity" DECIMAL(24,6) NOT NULL,
  "reasonCode" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resolvedAt" TIMESTAMP(3),
  "resolvedByUserId" TEXT,
  "adjustmentId" TEXT UNIQUE,
  CONSTRAINT "inventory_valuation_issue_quantity_check" CHECK ("quantity" > 0)
);

CREATE TABLE "inventory_valuation_adjustment_sequence" ("year" INTEGER PRIMARY KEY, "nextValue" INTEGER NOT NULL);

CREATE TABLE "landed_cost" (
  "id" TEXT PRIMARY KEY,
  "number" TEXT NOT NULL UNIQUE,
  "goodsReceiptId" TEXT NOT NULL,
  "allocationMethod" "LandedCostAllocationMethod" NOT NULL,
  "status" "LandedCostStatus" NOT NULL DEFAULT 'DRAFT',
  "category" TEXT NOT NULL,
  "totalAmount" DECIMAL(30,6) NOT NULL,
  "description" TEXT NOT NULL,
  "reference" TEXT,
  "createdByUserId" TEXT NOT NULL,
  "postedByUserId" TEXT,
  "postedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "landed_cost_total_check" CHECK ("totalAmount" > 0)
);

CREATE TABLE "landed_cost_allocation" (
  "id" TEXT PRIMARY KEY,
  "landedCostId" TEXT NOT NULL,
  "goodsReceiptLineId" TEXT NOT NULL,
  "allocatedAmount" DECIMAL(30,6) NOT NULL,
  CONSTRAINT "landed_cost_allocation_amount_check" CHECK ("allocatedAmount" >= 0),
  CONSTRAINT "landed_cost_allocation_unique" UNIQUE ("landedCostId", "goodsReceiptLineId")
);

CREATE TABLE "landed_cost_sequence" ("year" INTEGER PRIMARY KEY, "nextValue" INTEGER NOT NULL);

CREATE TABLE "production_cost_entry" (
  "id" TEXT PRIMARY KEY,
  "productionBatchId" TEXT NOT NULL,
  "category" "ProductionCostCategory" NOT NULL,
  "amount" DECIMAL(30,6) NOT NULL,
  "description" TEXT NOT NULL,
  "reference" TEXT,
  "createdByUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "production_cost_entry_amount_check" CHECK ("amount" > 0)
);

CREATE TABLE "production_batch_cost_snapshot" (
  "id" TEXT PRIMARY KEY,
  "productionBatchId" TEXT NOT NULL UNIQUE,
  "productionLotId" TEXT NOT NULL UNIQUE,
  "status" "BatchCostingStatus" NOT NULL DEFAULT 'FINALIZED',
  "rawMaterialCost" DECIMAL(30,6) NOT NULL,
  "packagingCost" DECIMAL(30,6) NOT NULL,
  "additionalCost" DECIMAL(30,6) NOT NULL,
  "costCredits" DECIMAL(30,6) NOT NULL,
  "damagedPackagingExposure" DECIMAL(30,6) NOT NULL,
  "finishedGoodsCostPool" DECIMAL(30,6) NOT NULL,
  "actualGoodPieces" DECIMAL(24,6) NOT NULL,
  "costPerPiece" DECIMAL(30,12) NOT NULL,
  "calculationSnapshot" JSONB NOT NULL,
  "finalizedByUserId" TEXT NOT NULL,
  "finalizedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "production_batch_cost_snapshot_values_check" CHECK ("rawMaterialCost" >= 0 AND "packagingCost" >= 0 AND "additionalCost" >= 0 AND "costCredits" >= 0 AND "damagedPackagingExposure" >= 0 AND "finishedGoodsCostPool" >= 0 AND "actualGoodPieces" > 0 AND "costPerPiece" >= 0)
);

CREATE INDEX "inventory_valuation_balance_missingBasisCount_lastValuation_idx" ON "inventory_valuation_balance"("missingBasisCount", "lastValuationAt");
CREATE INDEX "inventory_valuation_entry_itemId_effectiveAt_id_idx" ON "inventory_valuation_entry"("itemId", "effectiveAt", "id");
CREATE INDEX "inventory_valuation_entry_entryType_effectiveAt_idx" ON "inventory_valuation_entry"("entryType", "effectiveAt");
CREATE INDEX "inventory_valuation_entry_sourceType_sourceId_idx" ON "inventory_valuation_entry"("sourceType", "sourceId");
CREATE INDEX "inventory_valuation_entry_productionBatchId_effectiveAt_idx" ON "inventory_valuation_entry"("productionBatchId", "effectiveAt");
CREATE INDEX "inventory_valuation_issue_itemId_resolvedAt_idx" ON "inventory_valuation_issue"("itemId", "resolvedAt");
CREATE INDEX "inventory_valuation_adjustment_itemId_createdAt_idx" ON "inventory_valuation_adjustment"("itemId", "createdAt");
CREATE INDEX "landed_cost_goodsReceiptId_status_createdAt_idx" ON "landed_cost"("goodsReceiptId", "status", "createdAt");
CREATE INDEX "landed_cost_allocation_goodsReceiptLineId_idx" ON "landed_cost_allocation"("goodsReceiptLineId");
CREATE INDEX "production_cost_entry_productionBatchId_category_createdAt_idx" ON "production_cost_entry"("productionBatchId", "category", "createdAt");
CREATE INDEX "production_batch_cost_snapshot_status_finalizedAt_idx" ON "production_batch_cost_snapshot"("status", "finalizedAt");

ALTER TABLE "inventory_valuation_balance" ADD CONSTRAINT "inventory_valuation_balance_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "inventory_valuation_entry" ADD CONSTRAINT "inventory_valuation_entry_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "inventory_valuation_entry" ADD CONSTRAINT "inventory_valuation_entry_inventoryMovementId_fkey" FOREIGN KEY ("inventoryMovementId") REFERENCES "inventory_movement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "inventory_valuation_entry" ADD CONSTRAINT "inventory_valuation_entry_productionBatchId_fkey" FOREIGN KEY ("productionBatchId") REFERENCES "production_batch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "inventory_valuation_entry" ADD CONSTRAINT "inventory_valuation_entry_inventoryLotId_fkey" FOREIGN KEY ("inventoryLotId") REFERENCES "inventory_lot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "inventory_valuation_entry" ADD CONSTRAINT "inventory_valuation_entry_productionLotId_fkey" FOREIGN KEY ("productionLotId") REFERENCES "production_lot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "inventory_valuation_entry" ADD CONSTRAINT "inventory_valuation_entry_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "inventory_valuation_issue" ADD CONSTRAINT "inventory_valuation_issue_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "inventory_valuation_issue" ADD CONSTRAINT "inventory_valuation_issue_inventoryMovementId_fkey" FOREIGN KEY ("inventoryMovementId") REFERENCES "inventory_movement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "inventory_valuation_issue" ADD CONSTRAINT "inventory_valuation_issue_resolvedByUserId_fkey" FOREIGN KEY ("resolvedByUserId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "inventory_valuation_issue" ADD CONSTRAINT "inventory_valuation_issue_adjustmentId_fkey" FOREIGN KEY ("adjustmentId") REFERENCES "inventory_valuation_adjustment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "inventory_valuation_adjustment" ADD CONSTRAINT "inventory_valuation_adjustment_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "inventory_valuation_adjustment" ADD CONSTRAINT "inventory_valuation_adjustment_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "landed_cost" ADD CONSTRAINT "landed_cost_goodsReceiptId_fkey" FOREIGN KEY ("goodsReceiptId") REFERENCES "goods_receipt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "landed_cost" ADD CONSTRAINT "landed_cost_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "landed_cost" ADD CONSTRAINT "landed_cost_postedByUserId_fkey" FOREIGN KEY ("postedByUserId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "landed_cost_allocation" ADD CONSTRAINT "landed_cost_allocation_landedCostId_fkey" FOREIGN KEY ("landedCostId") REFERENCES "landed_cost"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "landed_cost_allocation" ADD CONSTRAINT "landed_cost_allocation_goodsReceiptLineId_fkey" FOREIGN KEY ("goodsReceiptLineId") REFERENCES "goods_receipt_line"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "production_cost_entry" ADD CONSTRAINT "production_cost_entry_productionBatchId_fkey" FOREIGN KEY ("productionBatchId") REFERENCES "production_batch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "production_cost_entry" ADD CONSTRAINT "production_cost_entry_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "production_batch_cost_snapshot" ADD CONSTRAINT "production_batch_cost_snapshot_productionBatchId_fkey" FOREIGN KEY ("productionBatchId") REFERENCES "production_batch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "production_batch_cost_snapshot" ADD CONSTRAINT "production_batch_cost_snapshot_productionLotId_fkey" FOREIGN KEY ("productionLotId") REFERENCES "production_lot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "production_batch_cost_snapshot" ADD CONSTRAINT "production_batch_cost_snapshot_finalizedByUserId_fkey" FOREIGN KEY ("finalizedByUserId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION prevent_phase21_immutable_change() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Phase 21 finalized valuation/costing history is immutable';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER inventory_valuation_entry_immutable BEFORE UPDATE OR DELETE ON "inventory_valuation_entry" FOR EACH ROW EXECUTE FUNCTION prevent_phase21_immutable_change();
CREATE TRIGGER inventory_valuation_adjustment_immutable BEFORE UPDATE OR DELETE ON "inventory_valuation_adjustment" FOR EACH ROW EXECUTE FUNCTION prevent_phase21_immutable_change();
CREATE TRIGGER production_batch_cost_snapshot_immutable BEFORE UPDATE OR DELETE ON "production_batch_cost_snapshot" FOR EACH ROW EXECUTE FUNCTION prevent_phase21_immutable_change();

CREATE OR REPLACE FUNCTION protect_finalized_production_cost_entry() RETURNS trigger AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM "production_batch_cost_snapshot" WHERE "productionBatchId" = OLD."productionBatchId") THEN
    RAISE EXCEPTION 'Finalized batch cost entries are immutable';
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER production_cost_entry_finalized_guard BEFORE UPDATE OR DELETE ON "production_cost_entry" FOR EACH ROW EXECUTE FUNCTION protect_finalized_production_cost_entry();
