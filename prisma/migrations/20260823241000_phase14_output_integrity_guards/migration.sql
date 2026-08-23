DO $$
DECLARE function_definition text;
BEGIN
  SELECT pg_get_functiondef('validate_production_batch()'::regprocedure) INTO function_definition;
  function_definition := replace(
    function_definition,
    'OLD."status" IN (''IN_PROGRESS'', ''COMPLETED'', ''CANCELLED'') AND NEW."status" <> OLD."status"',
    'OLD."status" = ''IN_PROGRESS'' AND NEW."status" NOT IN (''IN_PROGRESS'', ''COMPLETED'') OR OLD."status" IN (''COMPLETED'', ''CANCELLED'') AND NEW."status" <> OLD."status"'
  );
  EXECUTE function_definition;
END;
$$;

CREATE OR REPLACE FUNCTION validate_production_batch_completion()
RETURNS trigger AS $$
DECLARE custody numeric;
BEGIN
  IF (NEW."completedByUserId", NEW."completedAt", NEW."completionExplanation") IS DISTINCT FROM
     (OLD."completedByUserId", OLD."completedAt", OLD."completionExplanation")
     AND NOT (OLD."status" = 'IN_PROGRESS' AND NEW."status" = 'COMPLETED') THEN
    RAISE EXCEPTION 'Completion metadata may be written only during batch completion.';
  END IF;
  IF NEW."status" = 'COMPLETED' AND OLD."status" <> 'COMPLETED' THEN
    IF OLD."status" <> 'IN_PROGRESS' OR NEW."completedByUserId" IS NULL OR NEW."completedAt" IS NULL THEN
      RAISE EXCEPTION 'Only an IN_PROGRESS batch may be completed with actor and timestamp.';
    END IF;
    SELECT COALESCE(sum("quantity"), 0) INTO custody FROM "inventory_movement"
      WHERE "productionBatchId" = NEW."id" AND "status" = 'IN_PRODUCTION';
    IF custody <> 0 THEN RAISE EXCEPTION 'Batch completion requires zero IN_PRODUCTION custody.'; END IF;
    IF NOT EXISTS (SELECT 1 FROM "production_output_transaction" WHERE "productionBatchId" = NEW."id" AND "outputType" = 'GOOD' AND "status" = 'POSTED') THEN
      RAISE EXCEPTION 'Batch completion requires posted good output.';
    END IF;
    IF EXISTS (SELECT 1 FROM "production_output_transaction" WHERE "productionBatchId" = NEW."id" AND "status" = 'DRAFT') THEN
      RAISE EXCEPTION 'Batch completion requires all output drafts to be posted or cancelled.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER production_batch_completion_validate_trg
BEFORE UPDATE ON "production_batch"
FOR EACH ROW EXECUTE FUNCTION validate_production_batch_completion();

CREATE OR REPLACE FUNCTION validate_production_output_transaction()
RETURNS trigger AS $$
DECLARE batch_row RECORD; movement_count integer;
BEGIN
  SELECT pb."status", pb."finishedGoodsDestinationWarehouseId", pb."productContentCanonicalUnitId",
         pb."productContentCanonicalDimension" INTO batch_row
    FROM "production_batch" pb WHERE pb."id" = NEW."productionBatchId";
  IF batch_row IS NULL OR batch_row."status" <> 'IN_PROGRESS' THEN
    RAISE EXCEPTION 'Production output requires an IN_PROGRESS batch.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM "warehouse" WHERE "id" = NEW."destinationWarehouseId" AND "active" = true) THEN
    RAISE EXCEPTION 'Production output destination warehouse must be active.';
  END IF;
  IF NEW."expiryDate" IS NOT NULL AND NEW."expiryDate" < NEW."productionDate" THEN
    RAISE EXCEPTION 'Production output expiry cannot precede production date.';
  END IF;
  IF NEW."outputType" = 'GOOD' AND NEW."destinationWarehouseId" <> batch_row."finishedGoodsDestinationWarehouseId" THEN
    RAISE EXCEPTION 'Good output must use the batch finished-goods destination.';
  ELSIF NEW."outputType" <> 'GOOD' AND (
    NEW."canonicalUnitId" <> batch_row."productContentCanonicalUnitId" OR
    NEW."canonicalUnitDimension" <> batch_row."productContentCanonicalDimension"
  ) THEN RAISE EXCEPTION 'Non-good output must use the batch product-content basis.'; END IF;
  IF NEW."outputType" = 'PROCESS_LOSS' AND length(trim(COALESCE(NEW."notes", ''))) < 3 THEN
    RAISE EXCEPTION 'Process loss requires explanatory notes.';
  END IF;
  IF TG_OP = 'INSERT' AND NEW."status" <> 'DRAFT' THEN RAISE EXCEPTION 'Output must be created as DRAFT.'; END IF;
  IF TG_OP = 'UPDATE' THEN
    IF OLD."status" = 'DRAFT' AND NEW."status" NOT IN ('DRAFT', 'POSTED', 'CANCELLED') THEN
      RAISE EXCEPTION 'Invalid production output transition.';
    ELSIF OLD."status" IN ('POSTED', 'CANCELLED') AND NEW IS DISTINCT FROM OLD THEN
      RAISE EXCEPTION 'Posted and cancelled production output is immutable.';
    END IF;
    IF OLD."status" = 'DRAFT' AND NEW."status" <> 'DRAFT' AND (
      NEW."outputNumber", NEW."productionBatchId", NEW."outputType", NEW."transactionDate",
      NEW."cartons", NEW."loosePieces", NEW."totalPieces", NEW."enteredQuantity", NEW."enteredUnitId",
      NEW."normalizedQuantity", NEW."canonicalUnitId", NEW."productionDate", NEW."expiryDate",
      NEW."destinationWarehouseId", NEW."lossReason", NEW."lossNature", NEW."notes", NEW."createdByUserId"
    ) IS DISTINCT FROM (
      OLD."outputNumber", OLD."productionBatchId", OLD."outputType", OLD."transactionDate",
      OLD."cartons", OLD."loosePieces", OLD."totalPieces", OLD."enteredQuantity", OLD."enteredUnitId",
      OLD."normalizedQuantity", OLD."canonicalUnitId", OLD."productionDate", OLD."expiryDate",
      OLD."destinationWarehouseId", OLD."lossReason", OLD."lossNature", OLD."notes", OLD."createdByUserId"
    ) THEN RAISE EXCEPTION 'Posting or cancellation cannot rewrite output draft.'; END IF;
  END IF;
  IF NEW."status" = 'POSTED' THEN
    IF NEW."postedByUserId" IS NULL OR NEW."postedAt" IS NULL OR NEW."productionLotId" IS NULL THEN
      RAISE EXCEPTION 'Posted output requires actor, timestamp, and production lot.';
    END IF;
    SELECT count(*) INTO movement_count FROM "inventory_movement" WHERE "productionOutputTransactionId" = NEW."id";
    IF (NEW."outputType" = 'PROCESS_LOSS' AND movement_count <> 0) OR
       (NEW."outputType" <> 'PROCESS_LOSS' AND movement_count <> 1) THEN
      RAISE EXCEPTION 'Posted output requires its complete inventory effect.';
    END IF;
  END IF;
  IF NEW."status" = 'CANCELLED' AND (NEW."cancelledByUserId" IS NULL OR NEW."cancelledAt" IS NULL OR length(trim(NEW."cancellationReason")) = 0) THEN
    RAISE EXCEPTION 'Cancelled output requires actor, timestamp, and reason.';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER production_output_transaction_validate_trg
BEFORE INSERT OR UPDATE ON "production_output_transaction"
FOR EACH ROW EXECUTE FUNCTION validate_production_output_transaction();

CREATE OR REPLACE FUNCTION validate_production_lot()
RETURNS trigger AS $$
DECLARE batch_row RECORD;
BEGIN
  IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'Production lots are immutable.'; END IF;
  SELECT "finishedGoodId", "recipeId", "recipeVersion", "status" INTO batch_row
    FROM "production_batch" WHERE "id" = NEW."productionBatchId";
  IF batch_row IS NULL OR batch_row."status" <> 'IN_PROGRESS'
     OR NEW."finishedGoodId" <> batch_row."finishedGoodId" OR NEW."recipeId" <> batch_row."recipeId"
     OR NEW."recipeVersion" <> batch_row."recipeVersion" OR NEW."finishedGoodType" <> 'FINISHED_GOOD'
     OR (NEW."expiryDate" IS NOT NULL AND NEW."expiryDate" < NEW."productionDate") THEN
    RAISE EXCEPTION 'Production lot must preserve batch product, recipe, and valid dates.';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER production_lot_validate_trg BEFORE INSERT OR UPDATE ON "production_lot"
FOR EACH ROW EXECUTE FUNCTION validate_production_lot();

CREATE OR REPLACE FUNCTION prevent_production_output_delete()
RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'Production output is retained; cancel drafts instead.'; END; $$ LANGUAGE plpgsql;
CREATE TRIGGER production_output_no_delete_trg BEFORE DELETE ON "production_output_transaction"
FOR EACH ROW EXECUTE FUNCTION prevent_production_output_delete();
CREATE TRIGGER production_lot_no_delete_trg BEFORE DELETE ON "production_lot"
FOR EACH ROW EXECUTE FUNCTION prevent_production_output_delete();

CREATE OR REPLACE FUNCTION validate_production_output_movement()
RETURNS trigger AS $$
DECLARE source_row RECORD;
BEGIN
  IF NEW."movementType" NOT IN ('PRODUCTION_OUTPUT', 'PRODUCTION_REPROCESS_OUTPUT', 'PRODUCTION_REJECTED_OUTPUT') THEN RETURN NEW; END IF;
  SELECT pot."id", pot."outputType", pot."productionBatchId", pot."productionLotId",
         pb."finishedGoodId", pb."productContentCanonicalUnitId", i."stockUnitId"
    INTO source_row FROM "production_output_transaction" pot
    JOIN "production_batch" pb ON pb."id" = pot."productionBatchId"
    JOIN "item" i ON i."id" = pb."finishedGoodId"
   WHERE pot."id" = NEW."productionOutputTransactionId";
  IF source_row IS NULL OR NEW."quantity" <= 0 OR NEW."productionBatchId" <> source_row."productionBatchId"
     OR NEW."productionLotId" <> source_row."productionLotId" OR NEW."itemId" <> source_row."finishedGoodId"
     OR NEW."referenceType" <> 'PRODUCTION_OUTPUT_TRANSACTION' OR NEW."referenceId" <> source_row."id" THEN
    RAISE EXCEPTION 'Production output movement must preserve output, lot, batch, item, and reference.';
  END IF;
  IF NOT (
    (source_row."outputType" = 'GOOD' AND NEW."movementType" = 'PRODUCTION_OUTPUT' AND NEW."status" = 'AVAILABLE' AND NEW."canonicalUnitId" = source_row."stockUnitId") OR
    (source_row."outputType" = 'REPROCESS' AND NEW."movementType" = 'PRODUCTION_REPROCESS_OUTPUT' AND NEW."status" = 'REPROCESS' AND NEW."canonicalUnitId" = source_row."productContentCanonicalUnitId") OR
    (source_row."outputType" = 'REJECTED' AND NEW."movementType" = 'PRODUCTION_REJECTED_OUTPUT' AND NEW."status" = 'SCRAP' AND NEW."canonicalUnitId" = source_row."productContentCanonicalUnitId")
  ) THEN RAISE EXCEPTION 'Production output movement has an invalid type, status, or unit.'; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER production_output_movement_validate_trg BEFORE INSERT ON "inventory_movement"
FOR EACH ROW EXECUTE FUNCTION validate_production_output_movement();
