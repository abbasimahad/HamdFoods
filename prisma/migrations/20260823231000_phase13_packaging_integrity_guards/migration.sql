CREATE OR REPLACE FUNCTION validate_production_material_transaction()
RETURNS trigger AS $$
DECLARE
  batch_status "ProductionBatchStatus";
  line_count integer;
  movement_count integer;
BEGIN
  SELECT "status" INTO batch_status FROM "production_batch" WHERE "id" = NEW."productionBatchId";
  IF batch_status IS NULL THEN RAISE EXCEPTION 'Production material transaction requires a valid batch.'; END IF;

  IF NEW."materialType" = 'RAW_MATERIAL' THEN
    IF NEW."transactionType" = 'DAMAGE' THEN
      RAISE EXCEPTION 'Raw-material damage is outside this transaction workflow.';
    ELSIF NEW."transactionType" = 'ISSUE' AND batch_status NOT IN ('RELEASED', 'IN_PROGRESS') THEN
      RAISE EXCEPTION 'Material issue requires a RELEASED or IN_PROGRESS batch.';
    ELSIF NEW."transactionType" IN ('RETURN', 'CONSUMPTION') AND batch_status <> 'IN_PROGRESS' THEN
      RAISE EXCEPTION 'Material return and consumption require an IN_PROGRESS batch.';
    END IF;
  ELSIF NEW."materialType" = 'PACKAGING_MATERIAL' AND batch_status <> 'IN_PROGRESS' THEN
    RAISE EXCEPTION 'Packaging transactions require an IN_PROGRESS batch.';
  END IF;

  IF (NEW."transactionType" = 'DAMAGE') <> (NEW."damageReason" IS NOT NULL) THEN
    RAISE EXCEPTION 'Packaging damage requires one controlled reason and other operations must not set one.';
  END IF;
  IF TG_OP = 'INSERT' AND NEW."status" <> 'DRAFT' THEN
    RAISE EXCEPTION 'Production material transactions must be created as DRAFT.';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF OLD."status" = 'DRAFT' AND NEW."status" NOT IN ('DRAFT', 'POSTED', 'CANCELLED') THEN
      RAISE EXCEPTION 'Invalid production material transaction transition.';
    ELSIF OLD."status" IN ('POSTED', 'CANCELLED') AND NEW IS DISTINCT FROM OLD THEN
      RAISE EXCEPTION 'Posted and cancelled production material transactions are immutable.';
    END IF;
    IF OLD."status" = 'DRAFT' AND (
      NEW."transactionNumber", NEW."productionBatchId", NEW."materialType", NEW."transactionType",
      NEW."damageReason", NEW."transactionDate", NEW."notes", NEW."createdByUserId"
    ) IS DISTINCT FROM (
      OLD."transactionNumber", OLD."productionBatchId", OLD."materialType", OLD."transactionType",
      OLD."damageReason", OLD."transactionDate", OLD."notes", OLD."createdByUserId"
    ) AND NEW."status" <> 'DRAFT' THEN
      RAISE EXCEPTION 'Posting or cancellation cannot rewrite the transaction draft.';
    END IF;
  END IF;

  IF NEW."status" = 'POSTED' THEN
    IF NEW."postedByUserId" IS NULL OR NEW."postedAt" IS NULL THEN
      RAISE EXCEPTION 'Posted production material transaction requires actor and timestamp.';
    END IF;
    SELECT count(*) INTO line_count FROM "production_material_transaction_line" WHERE "transactionId" = NEW."id";
    SELECT count(*) INTO movement_count FROM "inventory_movement"
      WHERE "productionMaterialTransactionLineId" IN (
        SELECT "id" FROM "production_material_transaction_line" WHERE "transactionId" = NEW."id"
      );
    IF line_count = 0 OR
       (NEW."transactionType" IN ('ISSUE', 'RETURN', 'DAMAGE') AND movement_count <> line_count * 2) OR
       (NEW."transactionType" = 'CONSUMPTION' AND movement_count <> line_count) THEN
      RAISE EXCEPTION 'Posted transaction requires its complete inventory movement set.';
    END IF;
  END IF;
  IF NEW."status" = 'CANCELLED' AND (
    NEW."cancelledByUserId" IS NULL OR NEW."cancelledAt" IS NULL OR length(trim(NEW."cancellationReason")) = 0
  ) THEN RAISE EXCEPTION 'Cancelled draft requires actor, timestamp, and reason.'; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION guard_production_material_transaction_line()
RETURNS trigger AS $$
DECLARE
  transaction_row RECORD;
  requirement_row RECORD;
  lot_item_id text;
  custody_warehouse_id text;
BEGIN
  SELECT pmt."status", pmt."transactionType", pmt."materialType", pmt."productionBatchId",
         pb."rawMaterialWarehouseId", pb."packagingWarehouseId"
    INTO transaction_row
    FROM "production_material_transaction" pmt
    JOIN "production_batch" pb ON pb."id" = pmt."productionBatchId"
   WHERE pmt."id" = COALESCE(NEW."transactionId", OLD."transactionId");
  IF transaction_row IS NULL OR transaction_row."status" <> 'DRAFT' THEN
    RAISE EXCEPTION 'Material transaction lines may change only while DRAFT.';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;

  custody_warehouse_id := CASE WHEN transaction_row."materialType" = 'RAW_MATERIAL'
    THEN transaction_row."rawMaterialWarehouseId" ELSE transaction_row."packagingWarehouseId" END;
  IF transaction_row."materialType" = 'RAW_MATERIAL' THEN
    SELECT pmr."productionBatchId", pmr."itemId", pmr."canonicalUnitId", pmr."canonicalUnitDimension"
      INTO requirement_row FROM "production_material_requirement" pmr WHERE pmr."id" = NEW."batchRequirementId";
    IF NEW."packagingRequirementId" IS NOT NULL THEN RAISE EXCEPTION 'Raw material line cannot reference packaging.'; END IF;
  ELSE
    SELECT ppr."productionBatchId", ppr."itemId", ppr."canonicalUnitId", ppr."canonicalUnitDimension"
      INTO requirement_row FROM "production_packaging_requirement" ppr WHERE ppr."id" = NEW."packagingRequirementId";
    IF NEW."batchRequirementId" IS NOT NULL THEN RAISE EXCEPTION 'Packaging line cannot reference raw material.'; END IF;
  END IF;
  SELECT "itemId" INTO lot_item_id FROM "inventory_lot" WHERE "id" = NEW."inventoryLotId";
  IF requirement_row IS NULL OR requirement_row."productionBatchId" <> transaction_row."productionBatchId"
     OR requirement_row."itemId" <> NEW."itemId"
     OR requirement_row."canonicalUnitId" <> NEW."canonicalUnitId"
     OR requirement_row."canonicalUnitDimension" <> NEW."canonicalUnitDimension"
     OR lot_item_id IS NULL OR lot_item_id <> NEW."itemId"
     OR NEW."sourceWarehouseId" <> custody_warehouse_id
     OR NEW."itemType" <> transaction_row."materialType"
     OR NOT EXISTS (SELECT 1 FROM "warehouse" WHERE "id" = NEW."sourceWarehouseId" AND "active" = true)
     OR NOT EXISTS (SELECT 1 FROM "item" WHERE "id" = NEW."itemId" AND "itemType" = transaction_row."materialType" AND "active" = true)
     OR NOT EXISTS (SELECT 1 FROM "unit" WHERE "id" = NEW."enteredUnitId" AND "active" = true)
     OR NOT EXISTS (SELECT 1 FROM "unit" WHERE "id" = NEW."canonicalUnitId" AND "active" = true) THEN
    RAISE EXCEPTION 'Material line must preserve its active batch requirement, lot, warehouse, item, and units.';
  END IF;
  IF transaction_row."transactionType" = 'RETURN' THEN
    IF NEW."destinationWarehouseId" IS NULL OR NOT EXISTS (
      SELECT 1 FROM "warehouse" WHERE "id" = NEW."destinationWarehouseId" AND "active" = true
    ) THEN RAISE EXCEPTION 'Material return requires an active destination warehouse.'; END IF;
  ELSIF transaction_row."transactionType" = 'ISSUE' THEN
    IF NEW."destinationWarehouseId" <> custody_warehouse_id THEN
      RAISE EXCEPTION 'Material issue destination must be batch production custody.';
    END IF;
  ELSIF NEW."destinationWarehouseId" IS NOT NULL THEN
    RAISE EXCEPTION 'Consumption and damage have no destination warehouse.';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION validate_production_inventory_movement()
RETURNS trigger AS $$
DECLARE source_row RECORD;
BEGIN
  IF NEW."movementType" NOT IN (
    'PRODUCTION_ISSUE', 'PRODUCTION_RETURN', 'PRODUCTION_CONSUMPTION',
    'PACKAGING_ISSUE', 'PACKAGING_RETURN', 'PACKAGING_CONSUMPTION', 'PACKAGING_DAMAGE'
  ) THEN RETURN NEW; END IF;
  SELECT pmtl."itemId", pmtl."inventoryLotId", pmtl."canonicalUnitId",
         pmt."id" AS transaction_id, pmt."productionBatchId", pmt."materialType", pmt."transactionType"
    INTO source_row
    FROM "production_material_transaction_line" pmtl
    JOIN "production_material_transaction" pmt ON pmt."id" = pmtl."transactionId"
   WHERE pmtl."id" = NEW."productionMaterialTransactionLineId";
  IF source_row IS NULL OR NEW."productionBatchId" <> source_row."productionBatchId"
     OR NEW."itemId" <> source_row."itemId" OR NEW."inventoryLotId" <> source_row."inventoryLotId"
     OR NEW."canonicalUnitId" <> source_row."canonicalUnitId"
     OR NEW."referenceType" <> 'PRODUCTION_MATERIAL_TRANSACTION' OR NEW."referenceId" <> source_row.transaction_id THEN
    RAISE EXCEPTION 'Production inventory movement must preserve batch, transaction, item, unit, and lot provenance.';
  END IF;
  IF NOT (
    (source_row."materialType" = 'RAW_MATERIAL' AND source_row."transactionType" = 'ISSUE' AND NEW."movementType" = 'PRODUCTION_ISSUE' AND ((NEW."status" = 'AVAILABLE' AND NEW."quantity" < 0) OR (NEW."status" = 'IN_PRODUCTION' AND NEW."quantity" > 0))) OR
    (source_row."materialType" = 'RAW_MATERIAL' AND source_row."transactionType" = 'RETURN' AND NEW."movementType" = 'PRODUCTION_RETURN' AND ((NEW."status" = 'IN_PRODUCTION' AND NEW."quantity" < 0) OR (NEW."status" = 'AVAILABLE' AND NEW."quantity" > 0))) OR
    (source_row."materialType" = 'RAW_MATERIAL' AND source_row."transactionType" = 'CONSUMPTION' AND NEW."movementType" = 'PRODUCTION_CONSUMPTION' AND NEW."status" = 'IN_PRODUCTION' AND NEW."quantity" < 0) OR
    (source_row."materialType" = 'PACKAGING_MATERIAL' AND source_row."transactionType" = 'ISSUE' AND NEW."movementType" = 'PACKAGING_ISSUE' AND ((NEW."status" = 'AVAILABLE' AND NEW."quantity" < 0) OR (NEW."status" = 'IN_PRODUCTION' AND NEW."quantity" > 0))) OR
    (source_row."materialType" = 'PACKAGING_MATERIAL' AND source_row."transactionType" = 'RETURN' AND NEW."movementType" = 'PACKAGING_RETURN' AND ((NEW."status" = 'IN_PRODUCTION' AND NEW."quantity" < 0) OR (NEW."status" = 'AVAILABLE' AND NEW."quantity" > 0))) OR
    (source_row."materialType" = 'PACKAGING_MATERIAL' AND source_row."transactionType" = 'CONSUMPTION' AND NEW."movementType" = 'PACKAGING_CONSUMPTION' AND NEW."status" = 'IN_PRODUCTION' AND NEW."quantity" < 0) OR
    (source_row."materialType" = 'PACKAGING_MATERIAL' AND source_row."transactionType" = 'DAMAGE' AND NEW."movementType" = 'PACKAGING_DAMAGE' AND ((NEW."status" = 'IN_PRODUCTION' AND NEW."quantity" < 0) OR (NEW."status" = 'DAMAGED' AND NEW."quantity" > 0)))
  ) THEN RAISE EXCEPTION 'Production movement does not match its material class and operation.'; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
