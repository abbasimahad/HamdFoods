CREATE TYPE "RecipeStatus" AS ENUM ('DRAFT', 'APPROVED', 'INACTIVE');
CREATE TYPE "PackagingUsageBasis" AS ENUM ('PER_PIECE', 'PER_CARTON');

CREATE TABLE "recipe" (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "finishedGoodId" TEXT NOT NULL,
  "finishedGoodType" "ItemType" NOT NULL DEFAULT 'FINISHED_GOOD',
  "version" INTEGER NOT NULL,
  "standardBatchEnteredQuantity" DECIMAL(24,6) NOT NULL,
  "standardBatchUnitId" TEXT NOT NULL,
  "standardBatchUnitDimension" "UnitDimension" NOT NULL,
  "standardBatchNormalizedQuantity" DECIMAL(24,6) NOT NULL,
  "standardBatchCanonicalUnitId" TEXT NOT NULL,
  "standardBatchCanonicalDimension" "UnitDimension" NOT NULL,
  "expectedOutputEnteredQuantity" DECIMAL(24,6),
  "expectedOutputUnitId" TEXT,
  "expectedOutputUnitDimension" "UnitDimension",
  "expectedOutputNormalizedQuantity" DECIMAL(24,6),
  "expectedOutputCanonicalUnitId" TEXT,
  "expectedOutputCanonicalDimension" "UnitDimension",
  "status" "RecipeStatus" NOT NULL DEFAULT 'DRAFT',
  "notes" TEXT,
  "effectiveDate" DATE,
  "createdByUserId" TEXT NOT NULL,
  "approvedByUserId" TEXT,
  "approvedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "recipe_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "recipe_code_ck" CHECK ("code" ~ '^[A-Z0-9]+(?:-[A-Z0-9]+)*$'),
  CONSTRAINT "recipe_basis_ck" CHECK (
    "finishedGoodType" = 'FINISHED_GOOD' AND "version" > 0
    AND "standardBatchEnteredQuantity" > 0 AND "standardBatchNormalizedQuantity" > 0
    AND "standardBatchUnitDimension" = "standardBatchCanonicalDimension"
  ),
  CONSTRAINT "recipe_output_ck" CHECK (
    ("expectedOutputEnteredQuantity" IS NULL AND "expectedOutputUnitId" IS NULL
      AND "expectedOutputUnitDimension" IS NULL AND "expectedOutputNormalizedQuantity" IS NULL
      AND "expectedOutputCanonicalUnitId" IS NULL AND "expectedOutputCanonicalDimension" IS NULL)
    OR ("expectedOutputEnteredQuantity" > 0 AND "expectedOutputUnitId" IS NOT NULL
      AND "expectedOutputUnitDimension" IS NOT NULL AND "expectedOutputNormalizedQuantity" > 0
      AND "expectedOutputCanonicalUnitId" IS NOT NULL AND "expectedOutputCanonicalDimension" IS NOT NULL
      AND "expectedOutputUnitDimension" = "expectedOutputCanonicalDimension")
  ),
  CONSTRAINT "recipe_approval_metadata_ck" CHECK (
    (("status" = 'APPROVED') = ("approvedByUserId" IS NOT NULL AND "approvedAt" IS NOT NULL))
    OR ("status" = 'INACTIVE' AND "approvedByUserId" IS NOT NULL AND "approvedAt" IS NOT NULL)
  )
);

CREATE TABLE "recipe_ingredient" (
  "id" TEXT NOT NULL,
  "recipeId" TEXT NOT NULL,
  "sequence" INTEGER NOT NULL,
  "itemId" TEXT NOT NULL,
  "itemType" "ItemType" NOT NULL DEFAULT 'RAW_MATERIAL',
  "enteredQuantity" DECIMAL(24,6) NOT NULL,
  "enteredUnitId" TEXT NOT NULL,
  "enteredUnitDimension" "UnitDimension" NOT NULL,
  "normalizedQuantity" DECIMAL(24,6) NOT NULL,
  "canonicalUnitId" TEXT NOT NULL,
  "canonicalUnitDimension" "UnitDimension" NOT NULL,
  "allowancePercent" DECIMAL(7,4) NOT NULL DEFAULT 0,
  "processNotes" TEXT,
  CONSTRAINT "recipe_ingredient_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "recipe_ingredient_values_ck" CHECK (
    "itemType" = 'RAW_MATERIAL' AND "sequence" > 0
    AND "enteredQuantity" > 0 AND "normalizedQuantity" > 0
    AND "allowancePercent" >= 0
    AND "enteredUnitDimension" = "canonicalUnitDimension"
  )
);

CREATE TABLE "packaging_bom" (
  "id" TEXT NOT NULL,
  "recipeId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "packaging_bom_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "packaging_bom_line" (
  "id" TEXT NOT NULL,
  "packagingBomId" TEXT NOT NULL,
  "sequence" INTEGER NOT NULL,
  "itemId" TEXT NOT NULL,
  "itemType" "ItemType" NOT NULL DEFAULT 'PACKAGING_MATERIAL',
  "usageBasis" "PackagingUsageBasis" NOT NULL,
  "enteredQuantity" DECIMAL(24,6) NOT NULL,
  "enteredUnitId" TEXT NOT NULL,
  "enteredUnitDimension" "UnitDimension" NOT NULL,
  "normalizedQuantity" DECIMAL(24,6) NOT NULL,
  "canonicalUnitId" TEXT NOT NULL,
  "canonicalUnitDimension" "UnitDimension" NOT NULL,
  "allowancePercent" DECIMAL(7,4) NOT NULL DEFAULT 0,
  "notes" TEXT,
  CONSTRAINT "packaging_bom_line_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "packaging_bom_line_values_ck" CHECK (
    "itemType" = 'PACKAGING_MATERIAL' AND "sequence" > 0
    AND "enteredQuantity" > 0 AND "normalizedQuantity" > 0
    AND "allowancePercent" >= 0
    AND "enteredUnitDimension" = "canonicalUnitDimension"
  )
);

CREATE INDEX "recipe_finishedGoodId_status_version_idx" ON "recipe"("finishedGoodId", "status", "version");
CREATE INDEX "recipe_status_effectiveDate_idx" ON "recipe"("status", "effectiveDate");
CREATE INDEX "recipe_createdByUserId_idx" ON "recipe"("createdByUserId");
CREATE INDEX "recipe_approvedByUserId_idx" ON "recipe"("approvedByUserId");
CREATE UNIQUE INDEX "recipe_code_version_key" ON "recipe"("code", "version");
CREATE UNIQUE INDEX "recipe_one_approved_per_finished_good_uidx" ON "recipe"("finishedGoodId") WHERE "status" = 'APPROVED';
CREATE INDEX "recipe_ingredient_itemId_idx" ON "recipe_ingredient"("itemId");
CREATE INDEX "recipe_ingredient_enteredUnitId_idx" ON "recipe_ingredient"("enteredUnitId");
CREATE UNIQUE INDEX "recipe_ingredient_recipeId_sequence_key" ON "recipe_ingredient"("recipeId", "sequence");
CREATE UNIQUE INDEX "recipe_ingredient_recipeId_itemId_key" ON "recipe_ingredient"("recipeId", "itemId");
CREATE UNIQUE INDEX "packaging_bom_recipeId_key" ON "packaging_bom"("recipeId");
CREATE INDEX "packaging_bom_line_itemId_idx" ON "packaging_bom_line"("itemId");
CREATE INDEX "packaging_bom_line_enteredUnitId_idx" ON "packaging_bom_line"("enteredUnitId");
CREATE UNIQUE INDEX "packaging_bom_line_packagingBomId_sequence_key" ON "packaging_bom_line"("packagingBomId", "sequence");
CREATE UNIQUE INDEX "packaging_bom_line_packagingBomId_itemId_usageBasis_key" ON "packaging_bom_line"("packagingBomId", "itemId", "usageBasis");

ALTER TABLE "recipe" ADD CONSTRAINT "recipe_finishedGoodId_finishedGoodType_fkey" FOREIGN KEY ("finishedGoodId", "finishedGoodType") REFERENCES "item"("id", "itemType") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "recipe" ADD CONSTRAINT "recipe_standardBatchUnitId_standardBatchUnitDimension_fkey" FOREIGN KEY ("standardBatchUnitId", "standardBatchUnitDimension") REFERENCES "unit"("id", "dimension") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "recipe" ADD CONSTRAINT "recipe_standardBatchCanonicalUnitId_standardBatchCanonical_fkey" FOREIGN KEY ("standardBatchCanonicalUnitId", "standardBatchCanonicalDimension") REFERENCES "unit"("id", "dimension") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "recipe" ADD CONSTRAINT "recipe_expectedOutputUnitId_expectedOutputUnitDimension_fkey" FOREIGN KEY ("expectedOutputUnitId", "expectedOutputUnitDimension") REFERENCES "unit"("id", "dimension") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "recipe" ADD CONSTRAINT "recipe_expectedOutputCanonicalUnitId_expectedOutputCanonic_fkey" FOREIGN KEY ("expectedOutputCanonicalUnitId", "expectedOutputCanonicalDimension") REFERENCES "unit"("id", "dimension") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "recipe" ADD CONSTRAINT "recipe_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "recipe" ADD CONSTRAINT "recipe_approvedByUserId_fkey" FOREIGN KEY ("approvedByUserId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "recipe_ingredient" ADD CONSTRAINT "recipe_ingredient_recipeId_fkey" FOREIGN KEY ("recipeId") REFERENCES "recipe"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "recipe_ingredient" ADD CONSTRAINT "recipe_ingredient_itemId_itemType_fkey" FOREIGN KEY ("itemId", "itemType") REFERENCES "item"("id", "itemType") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "recipe_ingredient" ADD CONSTRAINT "recipe_ingredient_enteredUnitId_enteredUnitDimension_fkey" FOREIGN KEY ("enteredUnitId", "enteredUnitDimension") REFERENCES "unit"("id", "dimension") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "recipe_ingredient" ADD CONSTRAINT "recipe_ingredient_canonicalUnitId_canonicalUnitDimension_fkey" FOREIGN KEY ("canonicalUnitId", "canonicalUnitDimension") REFERENCES "unit"("id", "dimension") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "packaging_bom" ADD CONSTRAINT "packaging_bom_recipeId_fkey" FOREIGN KEY ("recipeId") REFERENCES "recipe"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "packaging_bom_line" ADD CONSTRAINT "packaging_bom_line_packagingBomId_fkey" FOREIGN KEY ("packagingBomId") REFERENCES "packaging_bom"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "packaging_bom_line" ADD CONSTRAINT "packaging_bom_line_itemId_itemType_fkey" FOREIGN KEY ("itemId", "itemType") REFERENCES "item"("id", "itemType") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "packaging_bom_line" ADD CONSTRAINT "packaging_bom_line_enteredUnitId_enteredUnitDimension_fkey" FOREIGN KEY ("enteredUnitId", "enteredUnitDimension") REFERENCES "unit"("id", "dimension") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "packaging_bom_line" ADD CONSTRAINT "packaging_bom_line_canonicalUnitId_canonicalUnitDimension_fkey" FOREIGN KEY ("canonicalUnitId", "canonicalUnitDimension") REFERENCES "unit"("id", "dimension") ON DELETE RESTRICT ON UPDATE CASCADE;
