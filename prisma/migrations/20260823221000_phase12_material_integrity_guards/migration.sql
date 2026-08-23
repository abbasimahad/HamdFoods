DO $$
DECLARE
  function_definition text;
BEGIN
  SELECT pg_get_functiondef('validate_production_batch()'::regprocedure)
    INTO function_definition;
  function_definition := replace(
    function_definition,
    'OLD."status" = ''RELEASED'' AND NEW."status" NOT IN (''RELEASED'', ''CANCELLED'')',
    'OLD."status" = ''RELEASED'' AND NEW."status" NOT IN (''RELEASED'', ''IN_PROGRESS'', ''CANCELLED'')'
  );
  EXECUTE function_definition;
END;
$$;

CREATE OR REPLACE FUNCTION validate_production_material_transaction()
RETURNS trigger AS $$
DECLARE
  batch_status "ProductionBatchStatus";
  line_count integer;
  movement_count integer;
BEGIN
  SELECT "status" INTO batch_status
    FROM "production_batch" WHERE "id" = NEW."productionBatchId";
  IF batch_status IS NULL THEN
    RAISE EXCEPTION 'Production material transaction requires a valid batch.';
  END IF;
  IF NEW."transactionType" = 'ISSUE' AND batch_status NOT IN ('RELEASED', 'IN_PROGRESS') THEN
    RAISE EXCEPTION 'Material issue requires a RELEASED or IN_PROGRESS batch.';
  ELSIF NEW."transactionType" IN ('RETURN', 'CONSUMPTION') AND batch_status <> 'IN_PROGRESS' THEN
    RAISE EXCEPTION 'Material return and consumption require an IN_PROGRESS batch.';
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
      NEW."transactionNumber", NEW."productionBatchId", NEW."transactionType",
      NEW."transactionDate", NEW."notes", NEW."createdByUserId"
    ) IS DISTINCT FROM (
      OLD."transactionNumber", OLD."productionBatchId", OLD."transactionType",
      OLD."transactionDate", OLD."notes", OLD."createdByUserId"
    ) AND NEW."status" <> 'DRAFT' THEN
      RAISE EXCEPTION 'Posting or cancellation cannot rewrite the transaction draft.';
    END IF;
  END IF;

  IF NEW."status" = 'POSTED' THEN
    IF NEW."postedByUserId" IS NULL OR NEW."postedAt" IS NULL THEN
      RAISE EXCEPTION 'Posted production material transaction requires actor and timestamp.';
    END IF;
    SELECT count(*) INTO line_count FROM "production_material_transaction_line"
      WHERE "transactionId" = NEW."id";
    SELECT count(*) INTO movement_count FROM "inventory_movement"
      WHERE "productionMaterialTransactionLineId" IN (
        SELECT "id" FROM "production_material_transaction_line" WHERE "transactionId" = NEW."id"
      );
    IF line_count = 0 OR
       (NEW."transactionType" IN ('ISSUE', 'RETURN') AND movement_count <> line_count * 2) OR
       (NEW."transactionType" = 'CONSUMPTION' AND movement_count <> line_count) THEN
      RAISE EXCEPTION 'Posted transaction requires its complete inventory movement set.';
    END IF;
  END IF;
  IF NEW."status" = 'CANCELLED' AND (
    NEW."cancelledByUserId" IS NULL OR NEW."cancelledAt" IS NULL OR
    length(trim(NEW."cancellationReason")) = 0
  ) THEN
    RAISE EXCEPTION 'Cancelled draft requires actor, timestamp, and reason.';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER production_material_transaction_validate_trg
BEFORE INSERT OR UPDATE ON "production_material_transaction"
FOR EACH ROW EXECUTE FUNCTION validate_production_material_transaction();

CREATE OR REPLACE FUNCTION guard_production_material_transaction_line()
RETURNS trigger AS $$
DECLARE
  transaction_row RECORD;
  requirement_row RECORD;
  lot_item_id text;
BEGIN
  SELECT pmt."status", pmt."transactionType", pmt."productionBatchId",
         pb."rawMaterialWarehouseId"
    INTO transaction_row
    FROM "production_material_transaction" pmt
    JOIN "production_batch" pb ON pb."id" = pmt."productionBatchId"
   WHERE pmt."id" = COALESCE(NEW."transactionId", OLD."transactionId");
  IF transaction_row IS NULL OR transaction_row."status" <> 'DRAFT' THEN
    RAISE EXCEPTION 'Material transaction lines may change only while DRAFT.';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;

  SELECT pmr."productionBatchId", pmr."itemId", pmr."canonicalUnitId",
         pmr."canonicalUnitDimension"
    INTO requirement_row
    FROM "production_material_requirement" pmr
   WHERE pmr."id" = NEW."batchRequirementId";
  SELECT "itemId" INTO lot_item_id FROM "inventory_lot" WHERE "id" = NEW."inventoryLotId";
  IF requirement_row IS NULL OR requirement_row."productionBatchId" <> transaction_row."productionBatchId"
     OR requirement_row."itemId" <> NEW."itemId"
     OR requirement_row."canonicalUnitId" <> NEW."canonicalUnitId"
     OR requirement_row."canonicalUnitDimension" <> NEW."canonicalUnitDimension"
     OR lot_item_id IS NULL OR lot_item_id <> NEW."itemId"
     OR NEW."sourceWarehouseId" <> transaction_row."rawMaterialWarehouseId"
     OR NOT EXISTS (SELECT 1 FROM "warehouse" WHERE "id" = NEW."sourceWarehouseId" AND "active" = true)
     OR NOT EXISTS (SELECT 1 FROM "item" WHERE "id" = NEW."itemId" AND "itemType" = 'RAW_MATERIAL' AND "active" = true)
     OR NOT EXISTS (SELECT 1 FROM "unit" WHERE "id" = NEW."enteredUnitId" AND "active" = true)
     OR NOT EXISTS (SELECT 1 FROM "unit" WHERE "id" = NEW."canonicalUnitId" AND "active" = true) THEN
    RAISE EXCEPTION 'Material line must preserve its active batch requirement, lot, warehouse, item, and units.';
  END IF;
  IF transaction_row."transactionType" = 'RETURN' THEN
    IF NEW."destinationWarehouseId" IS NULL OR NOT EXISTS (
      SELECT 1 FROM "warehouse" WHERE "id" = NEW."destinationWarehouseId" AND "active" = true
    ) THEN RAISE EXCEPTION 'Material return requires an active destination warehouse.'; END IF;
  ELSIF transaction_row."transactionType" = 'ISSUE' THEN
    IF NEW."destinationWarehouseId" <> transaction_row."rawMaterialWarehouseId" THEN
      RAISE EXCEPTION 'Material issue destination must be batch production custody.';
    END IF;
  ELSIF NEW."destinationWarehouseId" IS NOT NULL THEN
    RAISE EXCEPTION 'Material consumption has no destination warehouse.';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER production_material_transaction_line_guard_trg
BEFORE INSERT OR UPDATE OR DELETE ON "production_material_transaction_line"
FOR EACH ROW EXECUTE FUNCTION guard_production_material_transaction_line();

CREATE OR REPLACE FUNCTION validate_production_inventory_movement()
RETURNS trigger AS $$
DECLARE
  source_row RECORD;
BEGIN
  IF NEW."movementType" NOT IN ('PRODUCTION_ISSUE', 'PRODUCTION_RETURN', 'PRODUCTION_CONSUMPTION') THEN
    RETURN NEW;
  END IF;
  SELECT pmtl."itemId", pmtl."inventoryLotId", pmtl."canonicalUnitId",
         pmt."id" AS transaction_id, pmt."productionBatchId"
    INTO source_row
    FROM "production_material_transaction_line" pmtl
    JOIN "production_material_transaction" pmt ON pmt."id" = pmtl."transactionId"
   WHERE pmtl."id" = NEW."productionMaterialTransactionLineId";
  IF source_row IS NULL OR NEW."productionBatchId" <> source_row."productionBatchId"
     OR NEW."itemId" <> source_row."itemId" OR NEW."inventoryLotId" <> source_row."inventoryLotId"
     OR NEW."canonicalUnitId" <> source_row."canonicalUnitId"
     OR NEW."referenceType" <> 'PRODUCTION_MATERIAL_TRANSACTION'
     OR NEW."referenceId" <> source_row.transaction_id THEN
    RAISE EXCEPTION 'Production inventory movement must preserve batch, transaction, item, unit, and lot provenance.';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER production_inventory_movement_validate_trg
BEFORE INSERT ON "inventory_movement"
FOR EACH ROW EXECUTE FUNCTION validate_production_inventory_movement();

CREATE OR REPLACE FUNCTION prevent_production_material_transaction_delete()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Production material transactions are retained; cancel drafts instead.';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER production_material_transaction_no_delete_trg
BEFORE DELETE ON "production_material_transaction"
FOR EACH ROW EXECUTE FUNCTION prevent_production_material_transaction_delete();
