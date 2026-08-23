ALTER TYPE "InventoryMovementType" ADD VALUE 'PRODUCTION_REPROCESS_OUTPUT';
ALTER TYPE "InventoryMovementType" ADD VALUE 'PRODUCTION_REJECTED_OUTPUT';

CREATE TYPE "ProductionOutputType" AS ENUM ('GOOD', 'REPROCESS', 'REJECTED', 'PROCESS_LOSS');
CREATE TYPE "ProductionOutputStatus" AS ENUM ('DRAFT', 'POSTED', 'CANCELLED');
CREATE TYPE "ProductionLossReason" AS ENUM (
  'NORMAL_PROCESS_LOSS', 'EVAPORATION', 'SPILLAGE', 'SAMPLING',
  'EQUIPMENT_RETAINED', 'ABNORMAL_LOSS', 'OTHER'
);
CREATE TYPE "ProductionLossNature" AS ENUM ('NORMAL', 'ABNORMAL');

ALTER TABLE "production_batch"
  ADD COLUMN "completedByUserId" TEXT,
  ADD COLUMN "completedAt" TIMESTAMP(3),
  ADD COLUMN "completionExplanation" TEXT;

CREATE TABLE "production_lot" (
  "id" TEXT NOT NULL,
  "lotNumber" TEXT NOT NULL,
  "productionBatchId" TEXT NOT NULL,
  "finishedGoodId" TEXT NOT NULL,
  "finishedGoodType" "ItemType" NOT NULL DEFAULT 'FINISHED_GOOD',
  "recipeId" TEXT NOT NULL,
  "recipeVersion" INTEGER NOT NULL,
  "productionDate" DATE NOT NULL,
  "expiryDate" DATE,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "production_lot_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "production_lot_expiry_ck" CHECK ("expiryDate" IS NULL OR "expiryDate" >= "productionDate")
);

CREATE TABLE "production_output_transaction" (
  "id" TEXT NOT NULL,
  "outputNumber" TEXT NOT NULL,
  "productionBatchId" TEXT NOT NULL,
  "outputType" "ProductionOutputType" NOT NULL,
  "transactionDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "status" "ProductionOutputStatus" NOT NULL DEFAULT 'DRAFT',
  "cartons" INTEGER,
  "loosePieces" INTEGER,
  "totalPieces" DECIMAL(24,6),
  "enteredQuantity" DECIMAL(24,6),
  "enteredUnitId" TEXT,
  "enteredUnitDimension" "UnitDimension",
  "normalizedQuantity" DECIMAL(24,6),
  "canonicalUnitId" TEXT,
  "canonicalUnitDimension" "UnitDimension",
  "productionDate" DATE NOT NULL,
  "expiryDate" DATE,
  "destinationWarehouseId" TEXT NOT NULL,
  "productionLotId" TEXT,
  "lossReason" "ProductionLossReason",
  "lossNature" "ProductionLossNature",
  "notes" TEXT,
  "createdByUserId" TEXT NOT NULL,
  "postedByUserId" TEXT,
  "postedAt" TIMESTAMP(3),
  "cancelledByUserId" TEXT,
  "cancelledAt" TIMESTAMP(3),
  "cancellationReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "production_output_transaction_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "production_output_post_ck" CHECK (("postedByUserId" IS NULL) = ("postedAt" IS NULL)),
  CONSTRAINT "production_output_cancel_ck" CHECK (("cancelledByUserId" IS NULL) = ("cancelledAt" IS NULL) AND ("cancelledAt" IS NULL) = ("cancellationReason" IS NULL)),
  CONSTRAINT "production_output_expiry_ck" CHECK ("expiryDate" IS NULL OR "expiryDate" >= "productionDate"),
  CONSTRAINT "production_output_quantity_shape_ck" CHECK (
    ("outputType" = 'GOOD' AND "cartons" >= 0 AND "loosePieces" >= 0 AND "totalPieces" > 0
      AND "enteredQuantity" IS NULL AND "enteredUnitId" IS NULL AND "normalizedQuantity" IS NULL AND "canonicalUnitId" IS NULL)
    OR
    ("outputType" <> 'GOOD' AND "cartons" IS NULL AND "loosePieces" IS NULL AND "totalPieces" IS NULL
      AND "enteredQuantity" > 0 AND "enteredUnitId" IS NOT NULL AND "enteredUnitDimension" IS NOT NULL
      AND "normalizedQuantity" > 0 AND "canonicalUnitId" IS NOT NULL AND "canonicalUnitDimension" IS NOT NULL)
  ),
  CONSTRAINT "production_output_loss_shape_ck" CHECK (
    ("outputType" = 'PROCESS_LOSS') = ("lossReason" IS NOT NULL AND "lossNature" IS NOT NULL)
  )
);

CREATE TABLE "production_output_sequence" (
  "year" INTEGER NOT NULL,
  "nextValue" INTEGER NOT NULL,
  CONSTRAINT "production_output_sequence_pkey" PRIMARY KEY ("year"),
  CONSTRAINT "production_output_sequence_next_ck" CHECK ("nextValue" > 0)
);

ALTER TABLE "inventory_movement"
  ADD COLUMN "productionOutputTransactionId" TEXT,
  ADD COLUMN "productionLotId" TEXT;

CREATE UNIQUE INDEX "production_lot_lotNumber_key" ON "production_lot"("lotNumber");
CREATE UNIQUE INDEX "production_lot_productionBatchId_key" ON "production_lot"("productionBatchId");
CREATE INDEX "production_lot_finishedGoodId_productionDate_idx" ON "production_lot"("finishedGoodId", "productionDate");
CREATE INDEX "production_lot_recipeId_idx" ON "production_lot"("recipeId");
CREATE UNIQUE INDEX "production_output_transaction_outputNumber_key" ON "production_output_transaction"("outputNumber");
CREATE INDEX "production_output_transaction_batch_date_idx" ON "production_output_transaction"("productionBatchId", "transactionDate");
CREATE INDEX "production_output_transaction_type_status_date_idx" ON "production_output_transaction"("outputType", "status", "transactionDate");
CREATE INDEX "production_output_transaction_productionLotId_idx" ON "production_output_transaction"("productionLotId");
CREATE INDEX "production_output_transaction_destinationWarehouseId_idx" ON "production_output_transaction"("destinationWarehouseId");
CREATE INDEX "inventory_movement_productionOutputTransactionId_idx" ON "inventory_movement"("productionOutputTransactionId");
CREATE INDEX "inventory_movement_productionLotId_postedAt_idx" ON "inventory_movement"("productionLotId", "postedAt");

ALTER TABLE "production_batch" ADD CONSTRAINT "production_batch_completedByUserId_fkey" FOREIGN KEY ("completedByUserId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "production_lot" ADD CONSTRAINT "production_lot_productionBatchId_fkey" FOREIGN KEY ("productionBatchId") REFERENCES "production_batch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "production_lot" ADD CONSTRAINT "production_lot_finishedGood_fkey" FOREIGN KEY ("finishedGoodId", "finishedGoodType") REFERENCES "item"("id", "itemType") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "production_lot" ADD CONSTRAINT "production_lot_recipeId_fkey" FOREIGN KEY ("recipeId") REFERENCES "recipe"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "production_output_transaction" ADD CONSTRAINT "production_output_transaction_productionBatchId_fkey" FOREIGN KEY ("productionBatchId") REFERENCES "production_batch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "production_output_transaction" ADD CONSTRAINT "production_output_transaction_productionLotId_fkey" FOREIGN KEY ("productionLotId") REFERENCES "production_lot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "production_output_transaction" ADD CONSTRAINT "production_output_transaction_enteredUnit_fkey" FOREIGN KEY ("enteredUnitId", "enteredUnitDimension") REFERENCES "unit"("id", "dimension") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "production_output_transaction" ADD CONSTRAINT "production_output_transaction_canonicalUnit_fkey" FOREIGN KEY ("canonicalUnitId", "canonicalUnitDimension") REFERENCES "unit"("id", "dimension") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "production_output_transaction" ADD CONSTRAINT "production_output_transaction_destinationWarehouseId_fkey" FOREIGN KEY ("destinationWarehouseId") REFERENCES "warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "production_output_transaction" ADD CONSTRAINT "production_output_transaction_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "production_output_transaction" ADD CONSTRAINT "production_output_transaction_postedByUserId_fkey" FOREIGN KEY ("postedByUserId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "production_output_transaction" ADD CONSTRAINT "production_output_transaction_cancelledByUserId_fkey" FOREIGN KEY ("cancelledByUserId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "inventory_movement" ADD CONSTRAINT "inventory_movement_productionOutputTransactionId_fkey" FOREIGN KEY ("productionOutputTransactionId") REFERENCES "production_output_transaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "inventory_movement" ADD CONSTRAINT "inventory_movement_productionLotId_fkey" FOREIGN KEY ("productionLotId") REFERENCES "production_lot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

