CREATE TYPE "GoodsReceiptStatus" AS ENUM ('DRAFT', 'POSTED', 'QC_COMPLETED', 'CANCELLED');
CREATE TYPE "QcRejectionReason" AS ENUM ('DAMAGED', 'WRONG_ITEM', 'WRONG_SPECIFICATION', 'QUALITY_FAILURE', 'EXPIRED', 'SHORT_EXPIRY', 'CONTAMINATION', 'PACKAGING_DEFECT', 'OTHER');

ALTER TABLE "inventory_movement" ADD COLUMN "inventoryLotId" TEXT;

CREATE TABLE "goods_receipt" (
  "id" TEXT NOT NULL,
  "number" TEXT NOT NULL,
  "purchaseOrderId" TEXT NOT NULL,
  "supplierId" TEXT NOT NULL,
  "receiptDate" TIMESTAMP(3) NOT NULL,
  "warehouseId" TEXT NOT NULL,
  "supplierDeliveryNumber" TEXT,
  "vehicleReference" TEXT,
  "notes" TEXT,
  "status" "GoodsReceiptStatus" NOT NULL DEFAULT 'DRAFT',
  "receivedByUserId" TEXT NOT NULL,
  "postedByUserId" TEXT,
  "postedAt" TIMESTAMP(3),
  "qcByUserId" TEXT,
  "qcCompletedAt" TIMESTAMP(3),
  "cancelledByUserId" TEXT,
  "cancelledAt" TIMESTAMP(3),
  "cancellationReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "goods_receipt_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "goods_receipt_status_metadata_check" CHECK (
    ("status" = 'DRAFT' AND "postedAt" IS NULL AND "qcCompletedAt" IS NULL AND "cancelledAt" IS NULL)
    OR ("status" = 'POSTED' AND "postedAt" IS NOT NULL AND "postedByUserId" IS NOT NULL AND "qcCompletedAt" IS NULL AND "cancelledAt" IS NULL)
    OR ("status" = 'QC_COMPLETED' AND "postedAt" IS NOT NULL AND "postedByUserId" IS NOT NULL AND "qcCompletedAt" IS NOT NULL AND "qcByUserId" IS NOT NULL AND "cancelledAt" IS NULL)
    OR ("status" = 'CANCELLED' AND "postedAt" IS NULL AND "cancelledAt" IS NOT NULL AND "cancelledByUserId" IS NOT NULL AND length(btrim("cancellationReason")) > 0)
  )
);

CREATE TABLE "goods_receipt_line" (
  "id" TEXT NOT NULL,
  "goodsReceiptId" TEXT NOT NULL,
  "position" INTEGER NOT NULL,
  "purchaseOrderLineId" TEXT NOT NULL,
  "itemId" TEXT NOT NULL,
  "enteredQuantity" DECIMAL(24,6) NOT NULL,
  "enteredUnitId" TEXT NOT NULL,
  "normalizedQuantity" DECIMAL(24,6) NOT NULL,
  "canonicalUnitId" TEXT NOT NULL,
  "supplierLotNumber" TEXT,
  "manufacturingDate" DATE,
  "expiryDate" DATE,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "goods_receipt_line_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "goods_receipt_line_position_check" CHECK ("position" > 0),
  CONSTRAINT "goods_receipt_line_quantity_check" CHECK ("enteredQuantity" > 0 AND "normalizedQuantity" > 0),
  CONSTRAINT "goods_receipt_line_dates_check" CHECK ("manufacturingDate" IS NULL OR "expiryDate" IS NULL OR "expiryDate" >= "manufacturingDate")
);

CREATE TABLE "inventory_lot" (
  "id" TEXT NOT NULL,
  "itemId" TEXT NOT NULL,
  "supplierId" TEXT NOT NULL,
  "sourceGoodsReceiptId" TEXT NOT NULL,
  "sourceReceiptLineId" TEXT NOT NULL,
  "supplierLotNumber" TEXT,
  "manufacturingDate" DATE,
  "expiryDate" DATE,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "inventory_lot_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "inventory_lot_dates_check" CHECK ("manufacturingDate" IS NULL OR "expiryDate" IS NULL OR "expiryDate" >= "manufacturingDate")
);

CREATE TABLE "goods_receipt_qc_decision" (
  "id" TEXT NOT NULL,
  "goodsReceiptLineId" TEXT NOT NULL,
  "acceptedQuantity" DECIMAL(24,6) NOT NULL,
  "rejectedQuantity" DECIMAL(24,6) NOT NULL,
  "rejectionReason" "QcRejectionReason",
  "rejectionNotes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "goods_receipt_qc_decision_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "goods_receipt_qc_nonnegative_check" CHECK ("acceptedQuantity" >= 0 AND "rejectedQuantity" >= 0),
  CONSTRAINT "goods_receipt_qc_reason_check" CHECK (("rejectedQuantity" = 0 AND "rejectionReason" IS NULL) OR ("rejectedQuantity" > 0 AND "rejectionReason" IS NOT NULL))
);

CREATE TABLE "goods_receipt_sequence" (
  "year" INTEGER NOT NULL,
  "nextValue" INTEGER NOT NULL,
  CONSTRAINT "goods_receipt_sequence_pkey" PRIMARY KEY ("year"),
  CONSTRAINT "goods_receipt_sequence_positive_check" CHECK ("nextValue" > 0)
);

CREATE UNIQUE INDEX "goods_receipt_number_key" ON "goods_receipt"("number");
CREATE INDEX "goods_receipt_status_receiptDate_idx" ON "goods_receipt"("status", "receiptDate");
CREATE INDEX "goods_receipt_purchaseOrderId_receiptDate_idx" ON "goods_receipt"("purchaseOrderId", "receiptDate");
CREATE INDEX "goods_receipt_supplierId_receiptDate_idx" ON "goods_receipt"("supplierId", "receiptDate");
CREATE INDEX "goods_receipt_warehouseId_receiptDate_idx" ON "goods_receipt"("warehouseId", "receiptDate");
CREATE INDEX "goods_receipt_line_purchaseOrderLineId_idx" ON "goods_receipt_line"("purchaseOrderLineId");
CREATE INDEX "goods_receipt_line_itemId_idx" ON "goods_receipt_line"("itemId");
CREATE INDEX "goods_receipt_line_enteredUnitId_idx" ON "goods_receipt_line"("enteredUnitId");
CREATE UNIQUE INDEX "goods_receipt_line_goodsReceiptId_position_key" ON "goods_receipt_line"("goodsReceiptId", "position");
CREATE UNIQUE INDEX "goods_receipt_line_po_line_uidx" ON "goods_receipt_line"("goodsReceiptId", "purchaseOrderLineId");
CREATE UNIQUE INDEX "inventory_lot_sourceReceiptLineId_key" ON "inventory_lot"("sourceReceiptLineId");
CREATE INDEX "inventory_lot_itemId_supplierLotNumber_idx" ON "inventory_lot"("itemId", "supplierLotNumber");
CREATE INDEX "inventory_lot_supplierId_createdAt_idx" ON "inventory_lot"("supplierId", "createdAt");
CREATE INDEX "inventory_lot_sourceGoodsReceiptId_idx" ON "inventory_lot"("sourceGoodsReceiptId");
CREATE UNIQUE INDEX "goods_receipt_qc_decision_goodsReceiptLineId_key" ON "goods_receipt_qc_decision"("goodsReceiptLineId");
CREATE INDEX "inventory_movement_inventoryLotId_postedAt_idx" ON "inventory_movement"("inventoryLotId", "postedAt");
CREATE UNIQUE INDEX "purchase_order_id_supplier_uidx" ON "purchase_order"("id", "supplierId");
CREATE UNIQUE INDEX "purchase_order_line_identity_uidx" ON "purchase_order_line"("id", "itemId", "canonicalUnitId");

ALTER TABLE "inventory_movement" ADD CONSTRAINT "inventory_movement_inventoryLotId_fkey" FOREIGN KEY ("inventoryLotId") REFERENCES "inventory_lot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "goods_receipt" ADD CONSTRAINT "goods_receipt_purchaseOrderId_supplierId_fkey" FOREIGN KEY ("purchaseOrderId", "supplierId") REFERENCES "purchase_order"("id", "supplierId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "goods_receipt" ADD CONSTRAINT "goods_receipt_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "goods_receipt" ADD CONSTRAINT "goods_receipt_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "goods_receipt" ADD CONSTRAINT "goods_receipt_receivedByUserId_fkey" FOREIGN KEY ("receivedByUserId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "goods_receipt" ADD CONSTRAINT "goods_receipt_postedByUserId_fkey" FOREIGN KEY ("postedByUserId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "goods_receipt" ADD CONSTRAINT "goods_receipt_qcByUserId_fkey" FOREIGN KEY ("qcByUserId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "goods_receipt" ADD CONSTRAINT "goods_receipt_cancelledByUserId_fkey" FOREIGN KEY ("cancelledByUserId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "goods_receipt_line" ADD CONSTRAINT "goods_receipt_line_goodsReceiptId_fkey" FOREIGN KEY ("goodsReceiptId") REFERENCES "goods_receipt"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "goods_receipt_line" ADD CONSTRAINT "goods_receipt_line_purchaseOrderLineId_itemId_canonicalUni_fkey" FOREIGN KEY ("purchaseOrderLineId", "itemId", "canonicalUnitId") REFERENCES "purchase_order_line"("id", "itemId", "canonicalUnitId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "goods_receipt_line" ADD CONSTRAINT "goods_receipt_line_enteredUnitId_fkey" FOREIGN KEY ("enteredUnitId") REFERENCES "unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "inventory_lot" ADD CONSTRAINT "inventory_lot_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "inventory_lot" ADD CONSTRAINT "inventory_lot_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "inventory_lot" ADD CONSTRAINT "inventory_lot_sourceGoodsReceiptId_fkey" FOREIGN KEY ("sourceGoodsReceiptId") REFERENCES "goods_receipt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "inventory_lot" ADD CONSTRAINT "inventory_lot_sourceReceiptLineId_fkey" FOREIGN KEY ("sourceReceiptLineId") REFERENCES "goods_receipt_line"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "goods_receipt_qc_decision" ADD CONSTRAINT "goods_receipt_qc_decision_goodsReceiptLineId_fkey" FOREIGN KEY ("goodsReceiptLineId") REFERENCES "goods_receipt_line"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "inventory_movement" DROP CONSTRAINT "inventory_movement_known_direction_check";
ALTER TABLE "inventory_movement" ADD CONSTRAINT "inventory_movement_known_direction_check" CHECK (
  ("movementType" IN ('OPENING_BALANCE', 'ADJUSTMENT_IN', 'TRANSFER_IN', 'STATUS_IN', 'PURCHASE_RECEIPT') AND "quantity" > 0)
  OR ("movementType" IN ('ADJUSTMENT_OUT', 'TRANSFER_OUT', 'STATUS_OUT') AND "quantity" < 0)
  OR "movementType" NOT IN ('OPENING_BALANCE', 'ADJUSTMENT_IN', 'TRANSFER_IN', 'STATUS_IN', 'PURCHASE_RECEIPT', 'ADJUSTMENT_OUT', 'TRANSFER_OUT', 'STATUS_OUT')
);

CREATE FUNCTION enforce_goods_receipt_line_immutability() RETURNS trigger AS $$
DECLARE parent_status "GoodsReceiptStatus";
BEGIN
  SELECT "status" INTO parent_status FROM "goods_receipt" WHERE "id" = OLD."goodsReceiptId";
  IF parent_status <> 'DRAFT' THEN
    RAISE EXCEPTION 'Posted goods receipt lines are immutable';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER goods_receipt_line_immutable_after_posting BEFORE UPDATE OR DELETE ON "goods_receipt_line" FOR EACH ROW EXECUTE FUNCTION enforce_goods_receipt_line_immutability();

CREATE FUNCTION validate_inventory_lot_source() RETURNS trigger AS $$
DECLARE source_item TEXT; source_receipt TEXT; source_supplier TEXT;
BEGIN
  SELECT l."itemId", l."goodsReceiptId", r."supplierId" INTO source_item, source_receipt, source_supplier
  FROM "goods_receipt_line" l JOIN "goods_receipt" r ON r."id" = l."goodsReceiptId" WHERE l."id" = NEW."sourceReceiptLineId";
  IF source_item IS DISTINCT FROM NEW."itemId" OR source_receipt IS DISTINCT FROM NEW."sourceGoodsReceiptId" OR source_supplier IS DISTINCT FROM NEW."supplierId" THEN
    RAISE EXCEPTION 'Inventory lot source does not match its receipt line';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER inventory_lot_source_guard BEFORE INSERT ON "inventory_lot" FOR EACH ROW EXECUTE FUNCTION validate_inventory_lot_source();

CREATE FUNCTION prevent_immutable_receiving_record_changes() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Posted lot and QC records are immutable';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER inventory_lot_immutable BEFORE UPDATE OR DELETE ON "inventory_lot" FOR EACH ROW EXECUTE FUNCTION prevent_immutable_receiving_record_changes();
CREATE TRIGGER goods_receipt_qc_immutable BEFORE UPDATE OR DELETE ON "goods_receipt_qc_decision" FOR EACH ROW EXECUTE FUNCTION prevent_immutable_receiving_record_changes();

CREATE FUNCTION validate_goods_receipt_qc() RETURNS trigger AS $$
DECLARE received DECIMAL(24,6); parent_status "GoodsReceiptStatus";
BEGIN
  SELECT l."normalizedQuantity", r."status" INTO received, parent_status FROM "goods_receipt_line" l JOIN "goods_receipt" r ON r."id" = l."goodsReceiptId" WHERE l."id" = NEW."goodsReceiptLineId";
  IF parent_status <> 'POSTED' OR NEW."acceptedQuantity" + NEW."rejectedQuantity" <> received THEN
    RAISE EXCEPTION 'QC quantities must exactly reconcile a posted receipt line';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER goods_receipt_qc_reconciliation BEFORE INSERT ON "goods_receipt_qc_decision" FOR EACH ROW EXECUTE FUNCTION validate_goods_receipt_qc();

CREATE FUNCTION validate_inventory_movement_lot() RETURNS trigger AS $$
DECLARE lot_item TEXT;
BEGIN
  IF NEW."inventoryLotId" IS NOT NULL THEN
    SELECT "itemId" INTO lot_item FROM "inventory_lot" WHERE "id" = NEW."inventoryLotId";
    IF lot_item IS DISTINCT FROM NEW."itemId" THEN RAISE EXCEPTION 'Inventory movement item does not match lot item'; END IF;
  END IF;
  IF NEW."movementType" = 'PURCHASE_RECEIPT' AND (NEW."status" <> 'QUALITY_HOLD' OR NEW."inventoryLotId" IS NULL) THEN
    RAISE EXCEPTION 'Purchase receipts must enter QUALITY_HOLD with a lot';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER inventory_movement_lot_guard BEFORE INSERT ON "inventory_movement" FOR EACH ROW EXECUTE FUNCTION validate_inventory_movement_lot();
