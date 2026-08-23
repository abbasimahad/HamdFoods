CREATE TYPE "ProductionMaterialTransactionType" AS ENUM ('ISSUE', 'RETURN', 'CONSUMPTION');
CREATE TYPE "ProductionMaterialTransactionStatus" AS ENUM ('DRAFT', 'POSTED', 'CANCELLED');
ALTER TYPE "InventoryMovementType" ADD VALUE 'PRODUCTION_CONSUMPTION';
ALTER TYPE "InventoryStatus" ADD VALUE 'IN_PRODUCTION';

ALTER TABLE "inventory_movement"
  ADD COLUMN "productionBatchId" TEXT,
  ADD COLUMN "productionMaterialTransactionLineId" TEXT;

CREATE TABLE "production_material_transaction" (
  "id" TEXT NOT NULL,
  "transactionNumber" TEXT NOT NULL,
  "productionBatchId" TEXT NOT NULL,
  "transactionType" "ProductionMaterialTransactionType" NOT NULL,
  "transactionDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "status" "ProductionMaterialTransactionStatus" NOT NULL DEFAULT 'DRAFT',
  "notes" TEXT,
  "createdByUserId" TEXT NOT NULL,
  "postedByUserId" TEXT,
  "postedAt" TIMESTAMP(3),
  "cancelledByUserId" TEXT,
  "cancelledAt" TIMESTAMP(3),
  "cancellationReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "production_material_transaction_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "production_material_transaction_post_ck" CHECK (("postedByUserId" IS NULL) = ("postedAt" IS NULL)),
  CONSTRAINT "production_material_transaction_cancel_ck" CHECK (("cancelledByUserId" IS NULL) = ("cancelledAt" IS NULL) AND ("cancelledAt" IS NULL) = ("cancellationReason" IS NULL))
);

CREATE TABLE "production_material_transaction_line" (
  "id" TEXT NOT NULL,
  "transactionId" TEXT NOT NULL,
  "position" INTEGER NOT NULL,
  "batchRequirementId" TEXT NOT NULL,
  "itemId" TEXT NOT NULL,
  "itemType" "ItemType" NOT NULL DEFAULT 'RAW_MATERIAL',
  "sourceWarehouseId" TEXT NOT NULL,
  "destinationWarehouseId" TEXT,
  "inventoryLotId" TEXT NOT NULL,
  "enteredQuantity" DECIMAL(24,6) NOT NULL,
  "enteredUnitId" TEXT NOT NULL,
  "enteredUnitDimension" "UnitDimension" NOT NULL,
  "normalizedQuantity" DECIMAL(24,6) NOT NULL,
  "canonicalUnitId" TEXT NOT NULL,
  "canonicalUnitDimension" "UnitDimension" NOT NULL,
  "notes" TEXT,
  CONSTRAINT "production_material_transaction_line_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "production_material_transaction_line_values_ck" CHECK ("position" > 0 AND "enteredQuantity" > 0 AND "normalizedQuantity" > 0)
);

CREATE TABLE "production_material_transaction_sequence" (
  "transactionType" "ProductionMaterialTransactionType" NOT NULL,
  "year" INTEGER NOT NULL,
  "nextValue" INTEGER NOT NULL,
  CONSTRAINT "production_material_transaction_sequence_pkey" PRIMARY KEY ("transactionType", "year"),
  CONSTRAINT "production_material_transaction_sequence_next_ck" CHECK ("nextValue" > 0)
);

CREATE UNIQUE INDEX "production_material_transaction_transactionNumber_key" ON "production_material_transaction"("transactionNumber");
CREATE INDEX "production_material_transaction_batch_date_idx" ON "production_material_transaction"("productionBatchId", "transactionDate");
CREATE INDEX "production_material_transaction_type_status_date_idx" ON "production_material_transaction"("transactionType", "status", "transactionDate");
CREATE INDEX "production_material_transaction_createdByUserId_idx" ON "production_material_transaction"("createdByUserId");
CREATE UNIQUE INDEX "production_material_transaction_line_transaction_position_key" ON "production_material_transaction_line"("transactionId", "position");
CREATE INDEX "production_material_transaction_line_batchRequirementId_idx" ON "production_material_transaction_line"("batchRequirementId");
CREATE INDEX "production_material_transaction_line_item_lot_idx" ON "production_material_transaction_line"("itemId", "inventoryLotId");
CREATE INDEX "production_material_transaction_line_sourceWarehouseId_idx" ON "production_material_transaction_line"("sourceWarehouseId");
CREATE INDEX "production_material_transaction_line_destinationWarehouseId_idx" ON "production_material_transaction_line"("destinationWarehouseId");
CREATE INDEX "inventory_movement_productionBatchId_status_postedAt_idx" ON "inventory_movement"("productionBatchId", "status", "postedAt");
CREATE INDEX "inventory_movement_productionMaterialTransactionLineId_idx" ON "inventory_movement"("productionMaterialTransactionLineId");

ALTER TABLE "inventory_movement" ADD CONSTRAINT "inventory_movement_productionBatchId_fkey" FOREIGN KEY ("productionBatchId") REFERENCES "production_batch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "inventory_movement" ADD CONSTRAINT "inventory_movement_productionMaterialTransactionLineId_fkey" FOREIGN KEY ("productionMaterialTransactionLineId") REFERENCES "production_material_transaction_line"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "production_material_transaction" ADD CONSTRAINT "production_material_transaction_productionBatchId_fkey" FOREIGN KEY ("productionBatchId") REFERENCES "production_batch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "production_material_transaction" ADD CONSTRAINT "production_material_transaction_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "production_material_transaction" ADD CONSTRAINT "production_material_transaction_postedByUserId_fkey" FOREIGN KEY ("postedByUserId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "production_material_transaction" ADD CONSTRAINT "production_material_transaction_cancelledByUserId_fkey" FOREIGN KEY ("cancelledByUserId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "production_material_transaction_line" ADD CONSTRAINT "production_material_transaction_line_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "production_material_transaction"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "production_material_transaction_line" ADD CONSTRAINT "production_material_transaction_line_batchRequirementId_fkey" FOREIGN KEY ("batchRequirementId") REFERENCES "production_material_requirement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "production_material_transaction_line" ADD CONSTRAINT "production_material_transaction_line_item_fkey" FOREIGN KEY ("itemId", "itemType") REFERENCES "item"("id", "itemType") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "production_material_transaction_line" ADD CONSTRAINT "production_material_transaction_line_sourceWarehouseId_fkey" FOREIGN KEY ("sourceWarehouseId") REFERENCES "warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "production_material_transaction_line" ADD CONSTRAINT "production_material_transaction_line_destinationWarehouseId_fkey" FOREIGN KEY ("destinationWarehouseId") REFERENCES "warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "production_material_transaction_line" ADD CONSTRAINT "production_material_transaction_line_inventoryLotId_fkey" FOREIGN KEY ("inventoryLotId") REFERENCES "inventory_lot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "production_material_transaction_line" ADD CONSTRAINT "production_material_transaction_line_enteredUnit_fkey" FOREIGN KEY ("enteredUnitId", "enteredUnitDimension") REFERENCES "unit"("id", "dimension") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "production_material_transaction_line" ADD CONSTRAINT "production_material_transaction_line_canonicalUnit_fkey" FOREIGN KEY ("canonicalUnitId", "canonicalUnitDimension") REFERENCES "unit"("id", "dimension") ON DELETE RESTRICT ON UPDATE CASCADE;
