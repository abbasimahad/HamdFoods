CREATE TYPE "GoodsReceiptPurpose" AS ENUM ('PURCHASE', 'SUPPLIER_REPLACEMENT');
CREATE TYPE "PurchaseReturnStatus" AS ENUM ('DRAFT', 'POSTED', 'AWAITING_REPLACEMENT', 'COMPLETED', 'CANCELLED');
CREATE TYPE "PurchaseReturnSource" AS ENUM ('QC_REJECTED', 'POST_ACCEPTANCE_DEFECT');
CREATE TYPE "PurchaseReturnReason" AS ENUM ('QC_REJECTED', 'DAMAGED', 'PACKAGING_DEFECT', 'WRONG_SPECIFICATION', 'WRONG_ITEM', 'CONTAMINATION', 'EXPIRED', 'SHORT_EXPIRY', 'LATENT_DEFECT', 'SUPPLIER_RECALL', 'OTHER');

ALTER TABLE "goods_receipt"
  ADD COLUMN "purchaseReturnId" TEXT,
  ADD COLUMN "purpose" "GoodsReceiptPurpose" NOT NULL DEFAULT 'PURCHASE';
ALTER TABLE "goods_receipt_line" ADD COLUMN "purchaseReturnLineId" TEXT;

CREATE TABLE "purchased_material_quarantine" (
  "id" TEXT NOT NULL,
  "itemId" TEXT NOT NULL,
  "warehouseId" TEXT NOT NULL,
  "inventoryLotId" TEXT NOT NULL,
  "quantity" DECIMAL(24,6) NOT NULL,
  "canonicalUnitId" TEXT NOT NULL,
  "reason" "PurchaseReturnReason" NOT NULL,
  "notes" TEXT,
  "createdByUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "purchased_material_quarantine_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "purchased_material_quarantine_quantity_ck" CHECK ("quantity" > 0)
);

CREATE TABLE "purchase_return" (
  "id" TEXT NOT NULL,
  "number" TEXT NOT NULL,
  "supplierId" TEXT NOT NULL,
  "purchaseOrderId" TEXT NOT NULL,
  "originalGoodsReceiptId" TEXT NOT NULL,
  "returnDate" DATE NOT NULL,
  "sourceWarehouseId" TEXT NOT NULL,
  "status" "PurchaseReturnStatus" NOT NULL DEFAULT 'DRAFT',
  "reasonNotes" TEXT,
  "replacementExpected" BOOLEAN NOT NULL DEFAULT false,
  "supplierReturnReference" TEXT,
  "createdByUserId" TEXT NOT NULL,
  "postedByUserId" TEXT,
  "postedAt" TIMESTAMP(3),
  "cancelledByUserId" TEXT,
  "cancelledAt" TIMESTAMP(3),
  "cancellationReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "purchase_return_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "purchase_return_posting_metadata_ck" CHECK (
    (("status" IN ('POSTED','AWAITING_REPLACEMENT','COMPLETED')) = ("postedByUserId" IS NOT NULL AND "postedAt" IS NOT NULL))
    AND (("status" = 'CANCELLED') = ("cancelledByUserId" IS NOT NULL AND "cancelledAt" IS NOT NULL AND "cancellationReason" IS NOT NULL))
  )
);

CREATE TABLE "purchase_return_line" (
  "id" TEXT NOT NULL,
  "purchaseReturnId" TEXT NOT NULL,
  "position" INTEGER NOT NULL,
  "itemId" TEXT NOT NULL,
  "purchaseOrderLineId" TEXT NOT NULL,
  "originalGoodsReceiptLineId" TEXT NOT NULL,
  "inventoryLotId" TEXT NOT NULL,
  "source" "PurchaseReturnSource" NOT NULL,
  "purchasedMaterialQuarantineId" TEXT,
  "enteredQuantity" DECIMAL(24,6) NOT NULL,
  "enteredUnitId" TEXT NOT NULL,
  "normalizedQuantity" DECIMAL(24,6) NOT NULL,
  "canonicalUnitId" TEXT NOT NULL,
  "reason" "PurchaseReturnReason" NOT NULL,
  "replacementExpected" BOOLEAN NOT NULL DEFAULT false,
  "notes" TEXT,
  CONSTRAINT "purchase_return_line_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "purchase_return_line_quantity_ck" CHECK ("position" > 0 AND "enteredQuantity" > 0 AND "normalizedQuantity" > 0),
  CONSTRAINT "purchase_return_line_source_ck" CHECK (
    ("source" = 'QC_REJECTED' AND "purchasedMaterialQuarantineId" IS NULL)
    OR ("source" = 'POST_ACCEPTANCE_DEFECT' AND "purchasedMaterialQuarantineId" IS NOT NULL)
  )
);

CREATE TABLE "purchase_return_sequence" (
  "year" INTEGER NOT NULL,
  "nextValue" INTEGER NOT NULL,
  CONSTRAINT "purchase_return_sequence_pkey" PRIMARY KEY ("year"),
  CONSTRAINT "purchase_return_sequence_next_ck" CHECK ("nextValue" > 0)
);

CREATE INDEX "purchased_material_quarantine_inventoryLotId_warehouseId_cr_idx" ON "purchased_material_quarantine"("inventoryLotId", "warehouseId", "createdAt");
CREATE INDEX "purchased_material_quarantine_createdByUserId_idx" ON "purchased_material_quarantine"("createdByUserId");
CREATE UNIQUE INDEX "purchase_return_number_key" ON "purchase_return"("number");
CREATE INDEX "purchase_return_status_returnDate_idx" ON "purchase_return"("status", "returnDate");
CREATE INDEX "purchase_return_supplierId_returnDate_idx" ON "purchase_return"("supplierId", "returnDate");
CREATE INDEX "purchase_return_purchaseOrderId_returnDate_idx" ON "purchase_return"("purchaseOrderId", "returnDate");
CREATE INDEX "purchase_return_originalGoodsReceiptId_idx" ON "purchase_return"("originalGoodsReceiptId");
CREATE INDEX "purchase_return_line_purchaseOrderLineId_idx" ON "purchase_return_line"("purchaseOrderLineId");
CREATE INDEX "purchase_return_line_originalGoodsReceiptLineId_idx" ON "purchase_return_line"("originalGoodsReceiptLineId");
CREATE INDEX "purchase_return_line_inventoryLotId_idx" ON "purchase_return_line"("inventoryLotId");
CREATE INDEX "purchase_return_line_purchasedMaterialQuarantineId_idx" ON "purchase_return_line"("purchasedMaterialQuarantineId");
CREATE UNIQUE INDEX "purchase_return_line_purchaseReturnId_position_key" ON "purchase_return_line"("purchaseReturnId", "position");
CREATE INDEX "goods_receipt_purchaseReturnId_receiptDate_idx" ON "goods_receipt"("purchaseReturnId", "receiptDate");
CREATE INDEX "goods_receipt_line_purchaseReturnLineId_idx" ON "goods_receipt_line"("purchaseReturnLineId");

ALTER TABLE "goods_receipt" ADD CONSTRAINT "goods_receipt_purchaseReturnId_fkey" FOREIGN KEY ("purchaseReturnId") REFERENCES "purchase_return"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "goods_receipt_line" ADD CONSTRAINT "goods_receipt_line_purchaseReturnLineId_fkey" FOREIGN KEY ("purchaseReturnLineId") REFERENCES "purchase_return_line"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "purchased_material_quarantine" ADD CONSTRAINT "purchased_material_quarantine_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "purchased_material_quarantine" ADD CONSTRAINT "purchased_material_quarantine_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "purchased_material_quarantine" ADD CONSTRAINT "purchased_material_quarantine_inventoryLotId_fkey" FOREIGN KEY ("inventoryLotId") REFERENCES "inventory_lot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "purchased_material_quarantine" ADD CONSTRAINT "purchased_material_quarantine_canonicalUnitId_fkey" FOREIGN KEY ("canonicalUnitId") REFERENCES "unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "purchased_material_quarantine" ADD CONSTRAINT "purchased_material_quarantine_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "purchase_return" ADD CONSTRAINT "purchase_return_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "purchase_return" ADD CONSTRAINT "purchase_return_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "purchase_order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "purchase_return" ADD CONSTRAINT "purchase_return_originalGoodsReceiptId_fkey" FOREIGN KEY ("originalGoodsReceiptId") REFERENCES "goods_receipt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "purchase_return" ADD CONSTRAINT "purchase_return_sourceWarehouseId_fkey" FOREIGN KEY ("sourceWarehouseId") REFERENCES "warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "purchase_return" ADD CONSTRAINT "purchase_return_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "purchase_return" ADD CONSTRAINT "purchase_return_postedByUserId_fkey" FOREIGN KEY ("postedByUserId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "purchase_return" ADD CONSTRAINT "purchase_return_cancelledByUserId_fkey" FOREIGN KEY ("cancelledByUserId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "purchase_return_line" ADD CONSTRAINT "purchase_return_line_purchaseReturnId_fkey" FOREIGN KEY ("purchaseReturnId") REFERENCES "purchase_return"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "purchase_return_line" ADD CONSTRAINT "purchase_return_line_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "purchase_return_line" ADD CONSTRAINT "purchase_return_line_purchaseOrderLineId_fkey" FOREIGN KEY ("purchaseOrderLineId") REFERENCES "purchase_order_line"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "purchase_return_line" ADD CONSTRAINT "purchase_return_line_originalGoodsReceiptLineId_fkey" FOREIGN KEY ("originalGoodsReceiptLineId") REFERENCES "goods_receipt_line"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "purchase_return_line" ADD CONSTRAINT "purchase_return_line_inventoryLotId_fkey" FOREIGN KEY ("inventoryLotId") REFERENCES "inventory_lot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "purchase_return_line" ADD CONSTRAINT "purchase_return_line_purchasedMaterialQuarantineId_fkey" FOREIGN KEY ("purchasedMaterialQuarantineId") REFERENCES "purchased_material_quarantine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "purchase_return_line" ADD CONSTRAINT "purchase_return_line_enteredUnitId_fkey" FOREIGN KEY ("enteredUnitId") REFERENCES "unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "purchase_return_line" ADD CONSTRAINT "purchase_return_line_canonicalUnitId_fkey" FOREIGN KEY ("canonicalUnitId") REFERENCES "unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "goods_receipt" ADD CONSTRAINT "goods_receipt_replacement_link_ck" CHECK (
  ("purpose" = 'PURCHASE' AND "purchaseReturnId" IS NULL)
  OR ("purpose" = 'SUPPLIER_REPLACEMENT' AND "purchaseReturnId" IS NOT NULL)
);

CREATE OR REPLACE FUNCTION enforce_purchase_return_lifecycle() RETURNS trigger AS $$
BEGIN
  IF OLD."status" <> 'DRAFT' THEN
    IF NEW."supplierId" <> OLD."supplierId" OR NEW."purchaseOrderId" <> OLD."purchaseOrderId"
       OR NEW."originalGoodsReceiptId" <> OLD."originalGoodsReceiptId"
       OR NEW."returnDate" <> OLD."returnDate" OR NEW."sourceWarehouseId" <> OLD."sourceWarehouseId"
       OR NEW."reasonNotes" IS DISTINCT FROM OLD."reasonNotes"
       OR NEW."replacementExpected" <> OLD."replacementExpected"
       OR NEW."supplierReturnReference" IS DISTINCT FROM OLD."supplierReturnReference"
       OR NEW."createdByUserId" <> OLD."createdByUserId" OR NEW."postedByUserId" IS DISTINCT FROM OLD."postedByUserId"
       OR NEW."postedAt" IS DISTINCT FROM OLD."postedAt" THEN
      RAISE EXCEPTION 'Posted purchase return facts are immutable';
    END IF;
  END IF;
  IF NOT (
    (OLD."status" = 'DRAFT' AND NEW."status" IN ('DRAFT','POSTED','CANCELLED'))
    OR (OLD."status" = 'POSTED' AND NEW."status" IN ('AWAITING_REPLACEMENT','COMPLETED'))
    OR (OLD."status" = 'AWAITING_REPLACEMENT' AND NEW."status" IN ('AWAITING_REPLACEMENT','COMPLETED'))
    OR (OLD."status" = NEW."status")
  ) THEN RAISE EXCEPTION 'Invalid purchase return status transition'; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER purchase_return_lifecycle_guard BEFORE UPDATE ON "purchase_return"
FOR EACH ROW EXECUTE FUNCTION enforce_purchase_return_lifecycle();

CREATE OR REPLACE FUNCTION enforce_purchase_return_line_mutation() RETURNS trigger AS $$
DECLARE parent_status "PurchaseReturnStatus";
BEGIN
  SELECT "status" INTO parent_status FROM "purchase_return" WHERE "id" = COALESCE(OLD."purchaseReturnId", NEW."purchaseReturnId");
  IF parent_status <> 'DRAFT' THEN RAISE EXCEPTION 'Posted purchase return lines are immutable'; END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER purchase_return_line_update_guard BEFORE UPDATE OR DELETE ON "purchase_return_line"
FOR EACH ROW EXECUTE FUNCTION enforce_purchase_return_line_mutation();

CREATE OR REPLACE FUNCTION reject_purchased_quarantine_mutation() RETURNS trigger AS $$
BEGIN RAISE EXCEPTION 'Purchased-material quarantine records are immutable'; END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER purchased_quarantine_immutable BEFORE UPDATE OR DELETE ON "purchased_material_quarantine"
FOR EACH ROW EXECUTE FUNCTION reject_purchased_quarantine_mutation();
