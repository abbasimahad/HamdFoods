-- CreateEnum
CREATE TYPE "ItemType" AS ENUM ('RAW_MATERIAL', 'PACKAGING_MATERIAL', 'FINISHED_GOOD');

-- CreateEnum
CREATE TYPE "UnitDimension" AS ENUM ('MASS', 'VOLUME', 'COUNT');

-- CreateEnum
CREATE TYPE "PackagingKind" AS ENUM ('BOTTLE', 'JAR', 'CAP', 'LID', 'LABEL', 'CARTON', 'SHRINK_WRAP', 'SEAL', 'DIVIDER', 'BUCKET', 'OTHER');

-- CreateTable
CREATE TABLE "unit" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "dimension" "UnitDimension" NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "unit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "item_category" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "itemType" "ItemType" NOT NULL,
    "description" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "item_category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "item" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "itemType" "ItemType" NOT NULL,
    "categoryId" TEXT NOT NULL,
    "stockUnitId" TEXT NOT NULL,
    "packagingKind" "PackagingKind",
    "description" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "finished_good_profile" (
    "itemId" TEXT NOT NULL,
    "itemType" "ItemType" NOT NULL DEFAULT 'FINISHED_GOOD',
    "netContentQuantity" DECIMAL(18,6) NOT NULL,
    "netContentUnitId" TEXT NOT NULL,
    "netContentUnitDimension" "UnitDimension" NOT NULL,
    "piecesPerCarton" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "finished_good_profile_pkey" PRIMARY KEY ("itemId")
);

-- CreateIndex
CREATE UNIQUE INDEX "unit_code_key" ON "unit"("code");

-- CreateIndex
CREATE INDEX "unit_active_name_idx" ON "unit"("active", "name");

-- CreateIndex
CREATE UNIQUE INDEX "unit_id_dimension_uidx" ON "unit"("id", "dimension");

-- CreateIndex
CREATE UNIQUE INDEX "item_category_code_key" ON "item_category"("code");

-- CreateIndex
CREATE INDEX "item_category_itemType_active_name_idx" ON "item_category"("itemType", "active", "name");

-- CreateIndex
CREATE UNIQUE INDEX "item_category_id_type_uidx" ON "item_category"("id", "itemType");

-- CreateIndex
CREATE UNIQUE INDEX "item_code_key" ON "item"("code");

-- CreateIndex
CREATE INDEX "item_itemType_active_name_idx" ON "item"("itemType", "active", "name");

-- CreateIndex
CREATE INDEX "item_itemType_code_idx" ON "item"("itemType", "code");

-- CreateIndex
CREATE INDEX "item_categoryId_idx" ON "item"("categoryId");

-- CreateIndex
CREATE INDEX "item_stockUnitId_idx" ON "item"("stockUnitId");

-- CreateIndex
CREATE UNIQUE INDEX "item_id_type_uidx" ON "item"("id", "itemType");

-- CreateIndex
CREATE INDEX "finished_good_profile_netContentUnitId_idx" ON "finished_good_profile"("netContentUnitId");

-- CreateIndex
CREATE UNIQUE INDEX "finished_good_profile_item_type_uidx" ON "finished_good_profile"("itemId", "itemType");

-- AddForeignKey
ALTER TABLE "item" ADD CONSTRAINT "item_categoryId_itemType_fkey" FOREIGN KEY ("categoryId", "itemType") REFERENCES "item_category"("id", "itemType") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item" ADD CONSTRAINT "item_stockUnitId_fkey" FOREIGN KEY ("stockUnitId") REFERENCES "unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finished_good_profile" ADD CONSTRAINT "finished_good_profile_itemId_itemType_fkey" FOREIGN KEY ("itemId", "itemType") REFERENCES "item"("id", "itemType") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finished_good_profile" ADD CONSTRAINT "finished_good_profile_netContentUnitId_netContentUnitDimen_fkey" FOREIGN KEY ("netContentUnitId", "netContentUnitDimension") REFERENCES "unit"("id", "dimension") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Type-specific master-data invariants Prisma cannot express in schema syntax.
ALTER TABLE "item" ADD CONSTRAINT "item_packaging_kind_matches_type_check" CHECK (
    ("itemType" = 'PACKAGING_MATERIAL' AND "packagingKind" IS NOT NULL)
    OR ("itemType" <> 'PACKAGING_MATERIAL' AND "packagingKind" IS NULL)
);

ALTER TABLE "finished_good_profile" ADD CONSTRAINT "finished_good_profile_type_check" CHECK (
    "itemType" = 'FINISHED_GOOD'
);

ALTER TABLE "finished_good_profile" ADD CONSTRAINT "finished_good_profile_positive_content_check" CHECK (
    "netContentQuantity" > 0
    AND "piecesPerCarton" > 0
    AND "netContentUnitDimension" IN ('MASS', 'VOLUME')
);
