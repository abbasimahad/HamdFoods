-- CreateEnum
CREATE TYPE "InventoryStatus" AS ENUM ('AVAILABLE', 'RESERVED', 'QUALITY_HOLD', 'QUARANTINE', 'REPROCESS', 'DAMAGED', 'EXPIRED', 'SCRAP', 'IN_TRANSIT');

-- CreateEnum
CREATE TYPE "InventoryMovementType" AS ENUM ('OPENING_BALANCE', 'ADJUSTMENT_IN', 'ADJUSTMENT_OUT', 'TRANSFER_OUT', 'TRANSFER_IN', 'STATUS_OUT', 'STATUS_IN', 'PURCHASE_RECEIPT', 'PURCHASE_RETURN', 'PRODUCTION_ISSUE', 'PRODUCTION_RETURN', 'PRODUCTION_OUTPUT', 'PACKAGING_CONSUMPTION', 'SALES_DISPATCH', 'SALES_RETURN', 'DAMAGE', 'REPROCESS', 'SCRAP');

-- CreateTable
CREATE TABLE "warehouse" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "warehouse_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_movement" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "status" "InventoryStatus" NOT NULL,
    "quantity" DECIMAL(24,6) NOT NULL,
    "canonicalUnitId" TEXT NOT NULL,
    "movementType" "InventoryMovementType" NOT NULL,
    "referenceType" TEXT NOT NULL,
    "referenceId" TEXT,
    "sourceKey" TEXT,
    "groupId" TEXT,
    "reason" TEXT NOT NULL,
    "postedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdByUserId" TEXT NOT NULL,
    CONSTRAINT "inventory_movement_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "inventory_movement_nonzero_quantity_check" CHECK ("quantity" <> 0),
    CONSTRAINT "inventory_movement_known_direction_check" CHECK (
      ("movementType" IN ('OPENING_BALANCE', 'ADJUSTMENT_IN', 'TRANSFER_IN', 'STATUS_IN') AND "quantity" > 0)
      OR ("movementType" IN ('ADJUSTMENT_OUT', 'TRANSFER_OUT', 'STATUS_OUT') AND "quantity" < 0)
      OR "movementType" NOT IN ('OPENING_BALANCE', 'ADJUSTMENT_IN', 'TRANSFER_IN', 'STATUS_IN', 'ADJUSTMENT_OUT', 'TRANSFER_OUT', 'STATUS_OUT')
    ),
    CONSTRAINT "inventory_movement_reference_type_check" CHECK (length(btrim("referenceType")) > 0),
    CONSTRAINT "inventory_movement_reason_check" CHECK (length(btrim("reason")) > 0)
);

CREATE UNIQUE INDEX "warehouse_code_key" ON "warehouse"("code");
CREATE INDEX "warehouse_active_name_idx" ON "warehouse"("active", "name");
CREATE INDEX "inventory_movement_itemId_warehouseId_status_postedAt_idx" ON "inventory_movement"("itemId", "warehouseId", "status", "postedAt");
CREATE INDEX "inventory_movement_warehouseId_postedAt_idx" ON "inventory_movement"("warehouseId", "postedAt");
CREATE INDEX "inventory_movement_movementType_postedAt_idx" ON "inventory_movement"("movementType", "postedAt");
CREATE INDEX "inventory_movement_groupId_idx" ON "inventory_movement"("groupId");
CREATE INDEX "inventory_movement_createdByUserId_idx" ON "inventory_movement"("createdByUserId");
CREATE UNIQUE INDEX "inventory_movement_source_type_uidx" ON "inventory_movement"("sourceKey", "movementType");

ALTER TABLE "inventory_movement" ADD CONSTRAINT "inventory_movement_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "inventory_movement" ADD CONSTRAINT "inventory_movement_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "inventory_movement" ADD CONSTRAINT "inventory_movement_canonicalUnitId_fkey" FOREIGN KEY ("canonicalUnitId") REFERENCES "unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "inventory_movement" ADD CONSTRAINT "inventory_movement_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
