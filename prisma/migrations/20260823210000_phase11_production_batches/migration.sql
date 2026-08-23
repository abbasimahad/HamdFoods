CREATE TYPE "ProductionBatchStatus" AS ENUM (
  'DRAFT', 'PLANNED', 'RELEASED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'
);

CREATE TABLE "production_batch" (
  "id" TEXT NOT NULL,
  "batchNumber" TEXT NOT NULL,
  "recipeId" TEXT NOT NULL,
  "recipeVersion" INTEGER NOT NULL,
  "finishedGoodId" TEXT NOT NULL,
  "finishedGoodType" "ItemType" NOT NULL DEFAULT 'FINISHED_GOOD',
  "plannedBatchEnteredQuantity" DECIMAL(24,6) NOT NULL,
  "plannedBatchUnitId" TEXT NOT NULL,
  "plannedBatchUnitDimension" "UnitDimension" NOT NULL,
  "plannedBatchNormalizedQuantity" DECIMAL(24,6) NOT NULL,
  "plannedBatchCanonicalUnitId" TEXT NOT NULL,
  "plannedBatchCanonicalDimension" "UnitDimension" NOT NULL,
  "plannedProductionDate" DATE NOT NULL,
  "targetCompletionDate" DATE,
  "rawMaterialWarehouseId" TEXT NOT NULL,
  "packagingWarehouseId" TEXT NOT NULL,
  "finishedGoodsDestinationWarehouseId" TEXT NOT NULL,
  "status" "ProductionBatchStatus" NOT NULL DEFAULT 'DRAFT',
  "plannedExpectedOutputNormalizedQuantity" DECIMAL(24,6),
  "expectedOutputCanonicalUnitId" TEXT,
  "expectedOutputCanonicalDimension" "UnitDimension",
  "expectedYieldPercent" DECIMAL(12,6),
  "plannedCartons" INTEGER NOT NULL DEFAULT 0,
  "plannedLoosePieces" INTEGER NOT NULL DEFAULT 0,
  "plannedTotalPieces" DECIMAL(24,6) NOT NULL,
  "plannedProductContentNormalizedQuantity" DECIMAL(24,6) NOT NULL,
  "productContentCanonicalUnitId" TEXT NOT NULL,
  "productContentCanonicalDimension" "UnitDimension" NOT NULL,
  "expectedOutputDifferenceNormalizedQuantity" DECIMAL(24,6),
  "notes" TEXT,
  "createdByUserId" TEXT NOT NULL,
  "releasedByUserId" TEXT,
  "releasedAt" TIMESTAMP(3),
  "cancelledByUserId" TEXT,
  "cancelledAt" TIMESTAMP(3),
  "cancellationReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "production_batch_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "production_batch_positive_batch_ck" CHECK ("plannedBatchEnteredQuantity" > 0 AND "plannedBatchNormalizedQuantity" > 0),
  CONSTRAINT "production_batch_version_ck" CHECK ("recipeVersion" > 0),
  CONSTRAINT "production_batch_packaging_ck" CHECK ("plannedCartons" >= 0 AND "plannedLoosePieces" >= 0 AND "plannedTotalPieces" >= 0 AND scale("plannedTotalPieces") = 0),
  CONSTRAINT "production_batch_output_ck" CHECK ("plannedProductContentNormalizedQuantity" >= 0),
  CONSTRAINT "production_batch_expected_output_ck" CHECK (("plannedExpectedOutputNormalizedQuantity" IS NULL) = ("expectedOutputCanonicalUnitId" IS NULL) AND ("expectedOutputCanonicalUnitId" IS NULL) = ("expectedOutputCanonicalDimension" IS NULL)),
  CONSTRAINT "production_batch_release_actor_ck" CHECK (("releasedByUserId" IS NULL) = ("releasedAt" IS NULL)),
  CONSTRAINT "production_batch_cancel_actor_ck" CHECK (("cancelledByUserId" IS NULL) = ("cancelledAt" IS NULL) AND ("cancelledAt" IS NULL) = ("cancellationReason" IS NULL)),
  CONSTRAINT "production_batch_target_date_ck" CHECK ("targetCompletionDate" IS NULL OR "targetCompletionDate" >= "plannedProductionDate")
);

CREATE TABLE "production_material_requirement" (
  "id" TEXT NOT NULL,
  "productionBatchId" TEXT NOT NULL,
  "sequence" INTEGER NOT NULL,
  "recipeIngredientId" TEXT NOT NULL,
  "itemId" TEXT NOT NULL,
  "itemType" "ItemType" NOT NULL DEFAULT 'RAW_MATERIAL',
  "standardNormalizedQuantity" DECIMAL(24,6) NOT NULL,
  "plannedNormalizedQuantity" DECIMAL(24,6) NOT NULL,
  "allowancePercent" DECIMAL(7,4) NOT NULL,
  "recommendedIssueQuantity" DECIMAL(24,6) NOT NULL,
  "canonicalUnitId" TEXT NOT NULL,
  "canonicalUnitDimension" "UnitDimension" NOT NULL,
  CONSTRAINT "production_material_requirement_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "production_material_requirement_values_ck" CHECK ("sequence" > 0 AND "standardNormalizedQuantity" > 0 AND "plannedNormalizedQuantity" > 0 AND "allowancePercent" >= 0 AND "recommendedIssueQuantity" >= "plannedNormalizedQuantity")
);

CREATE TABLE "production_packaging_requirement" (
  "id" TEXT NOT NULL,
  "productionBatchId" TEXT NOT NULL,
  "sequence" INTEGER NOT NULL,
  "packagingBomLineId" TEXT NOT NULL,
  "itemId" TEXT NOT NULL,
  "itemType" "ItemType" NOT NULL DEFAULT 'PACKAGING_MATERIAL',
  "usageBasis" "PackagingUsageBasis" NOT NULL,
  "standardRequiredQuantity" DECIMAL(24,6) NOT NULL,
  "allowancePercent" DECIMAL(7,4) NOT NULL,
  "recommendedIssueQuantity" DECIMAL(24,6) NOT NULL,
  "canonicalUnitId" TEXT NOT NULL,
  "canonicalUnitDimension" "UnitDimension" NOT NULL,
  CONSTRAINT "production_packaging_requirement_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "production_packaging_requirement_values_ck" CHECK ("sequence" > 0 AND "standardRequiredQuantity" >= 0 AND "allowancePercent" >= 0 AND "recommendedIssueQuantity" >= "standardRequiredQuantity")
);

CREATE TABLE "production_batch_sequence" (
  "year" INTEGER NOT NULL,
  "nextValue" INTEGER NOT NULL,
  CONSTRAINT "production_batch_sequence_pkey" PRIMARY KEY ("year"),
  CONSTRAINT "production_batch_sequence_next_ck" CHECK ("nextValue" > 0)
);

CREATE UNIQUE INDEX "production_batch_batchNumber_key" ON "production_batch"("batchNumber");
CREATE INDEX "production_batch_status_plannedProductionDate_idx" ON "production_batch"("status", "plannedProductionDate");
CREATE INDEX "production_batch_finishedGoodId_plannedProductionDate_idx" ON "production_batch"("finishedGoodId", "plannedProductionDate");
CREATE INDEX "production_batch_recipeId_idx" ON "production_batch"("recipeId");
CREATE INDEX "production_batch_rawMaterialWarehouseId_idx" ON "production_batch"("rawMaterialWarehouseId");
CREATE INDEX "production_batch_packagingWarehouseId_idx" ON "production_batch"("packagingWarehouseId");
CREATE INDEX "production_batch_finishedGoodsDestinationWarehouseId_idx" ON "production_batch"("finishedGoodsDestinationWarehouseId");
CREATE INDEX "production_batch_createdByUserId_idx" ON "production_batch"("createdByUserId");
CREATE INDEX "production_material_requirement_itemId_idx" ON "production_material_requirement"("itemId");
CREATE INDEX "production_material_requirement_canonicalUnitId_idx" ON "production_material_requirement"("canonicalUnitId");
CREATE UNIQUE INDEX "production_material_requirement_batch_sequence_uidx" ON "production_material_requirement"("productionBatchId", "sequence");
CREATE UNIQUE INDEX "production_material_requirement_batch_recipe_line_uidx" ON "production_material_requirement"("productionBatchId", "recipeIngredientId");
CREATE INDEX "production_packaging_requirement_itemId_idx" ON "production_packaging_requirement"("itemId");
CREATE INDEX "production_packaging_requirement_canonicalUnitId_idx" ON "production_packaging_requirement"("canonicalUnitId");
CREATE UNIQUE INDEX "production_packaging_requirement_batch_sequence_uidx" ON "production_packaging_requirement"("productionBatchId", "sequence");
CREATE UNIQUE INDEX "production_packaging_requirement_batch_bom_line_uidx" ON "production_packaging_requirement"("productionBatchId", "packagingBomLineId");

ALTER TABLE "production_batch" ADD CONSTRAINT "production_batch_recipe_fkey" FOREIGN KEY ("recipeId") REFERENCES "recipe"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "production_batch" ADD CONSTRAINT "production_batch_finished_good_fkey" FOREIGN KEY ("finishedGoodId", "finishedGoodType") REFERENCES "item"("id", "itemType") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "production_batch" ADD CONSTRAINT "production_batch_entered_unit_fkey" FOREIGN KEY ("plannedBatchUnitId", "plannedBatchUnitDimension") REFERENCES "unit"("id", "dimension") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "production_batch" ADD CONSTRAINT "production_batch_canonical_unit_fkey" FOREIGN KEY ("plannedBatchCanonicalUnitId", "plannedBatchCanonicalDimension") REFERENCES "unit"("id", "dimension") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "production_batch" ADD CONSTRAINT "production_batch_expected_output_unit_fkey" FOREIGN KEY ("expectedOutputCanonicalUnitId", "expectedOutputCanonicalDimension") REFERENCES "unit"("id", "dimension") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "production_batch" ADD CONSTRAINT "production_batch_product_content_unit_fkey" FOREIGN KEY ("productContentCanonicalUnitId", "productContentCanonicalDimension") REFERENCES "unit"("id", "dimension") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "production_batch" ADD CONSTRAINT "production_batch_raw_warehouse_fkey" FOREIGN KEY ("rawMaterialWarehouseId") REFERENCES "warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "production_batch" ADD CONSTRAINT "production_batch_packaging_warehouse_fkey" FOREIGN KEY ("packagingWarehouseId") REFERENCES "warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "production_batch" ADD CONSTRAINT "production_batch_destination_warehouse_fkey" FOREIGN KEY ("finishedGoodsDestinationWarehouseId") REFERENCES "warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "production_batch" ADD CONSTRAINT "production_batch_created_by_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "production_batch" ADD CONSTRAINT "production_batch_released_by_fkey" FOREIGN KEY ("releasedByUserId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "production_batch" ADD CONSTRAINT "production_batch_cancelled_by_fkey" FOREIGN KEY ("cancelledByUserId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "production_material_requirement" ADD CONSTRAINT "production_material_requirement_batch_fkey" FOREIGN KEY ("productionBatchId") REFERENCES "production_batch"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "production_material_requirement" ADD CONSTRAINT "production_material_requirement_recipe_line_fkey" FOREIGN KEY ("recipeIngredientId") REFERENCES "recipe_ingredient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "production_material_requirement" ADD CONSTRAINT "production_material_requirement_item_fkey" FOREIGN KEY ("itemId", "itemType") REFERENCES "item"("id", "itemType") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "production_material_requirement" ADD CONSTRAINT "production_material_requirement_unit_fkey" FOREIGN KEY ("canonicalUnitId", "canonicalUnitDimension") REFERENCES "unit"("id", "dimension") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "production_packaging_requirement" ADD CONSTRAINT "production_packaging_requirement_batch_fkey" FOREIGN KEY ("productionBatchId") REFERENCES "production_batch"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "production_packaging_requirement" ADD CONSTRAINT "production_packaging_requirement_bom_line_fkey" FOREIGN KEY ("packagingBomLineId") REFERENCES "packaging_bom_line"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "production_packaging_requirement" ADD CONSTRAINT "production_packaging_requirement_item_fkey" FOREIGN KEY ("itemId", "itemType") REFERENCES "item"("id", "itemType") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "production_packaging_requirement" ADD CONSTRAINT "production_packaging_requirement_unit_fkey" FOREIGN KEY ("canonicalUnitId", "canonicalUnitDimension") REFERENCES "unit"("id", "dimension") ON DELETE RESTRICT ON UPDATE CASCADE;
