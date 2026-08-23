CREATE FUNCTION enforce_goods_receipt_lifecycle() RETURNS trigger AS $$
BEGIN
  IF OLD."status" <> 'DRAFT' AND (
    NEW."purchaseOrderId" IS DISTINCT FROM OLD."purchaseOrderId"
    OR NEW."supplierId" IS DISTINCT FROM OLD."supplierId"
    OR NEW."receiptDate" IS DISTINCT FROM OLD."receiptDate"
    OR NEW."warehouseId" IS DISTINCT FROM OLD."warehouseId"
    OR NEW."supplierDeliveryNumber" IS DISTINCT FROM OLD."supplierDeliveryNumber"
    OR NEW."vehicleReference" IS DISTINCT FROM OLD."vehicleReference"
    OR NEW."notes" IS DISTINCT FROM OLD."notes"
    OR NEW."receivedByUserId" IS DISTINCT FROM OLD."receivedByUserId"
  ) THEN
    RAISE EXCEPTION 'Posted goods receipt details are immutable';
  END IF;

  IF (OLD."status" = 'DRAFT' AND NEW."status" NOT IN ('DRAFT', 'POSTED', 'CANCELLED'))
    OR (OLD."status" = 'POSTED' AND NEW."status" NOT IN ('POSTED', 'QC_COMPLETED'))
    OR (OLD."status" IN ('QC_COMPLETED', 'CANCELLED') AND NEW."status" <> OLD."status")
  THEN
    RAISE EXCEPTION 'Invalid goods receipt status transition';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER goods_receipt_lifecycle_guard
BEFORE UPDATE ON "goods_receipt"
FOR EACH ROW EXECUTE FUNCTION enforce_goods_receipt_lifecycle();
