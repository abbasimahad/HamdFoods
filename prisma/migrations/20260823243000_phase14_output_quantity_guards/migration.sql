CREATE OR REPLACE FUNCTION validate_production_output_transaction()
RETURNS trigger AS $$
DECLARE batch_row RECORD; movement_count integer;
BEGIN
  SELECT pb."status", pb."finishedGoodsDestinationWarehouseId", pb."productContentCanonicalUnitId",
         pb."productContentCanonicalDimension", fgp."piecesPerCarton"
    INTO batch_row
    FROM "production_batch" pb
    JOIN "finished_good_profile" fgp ON fgp."itemId" = pb."finishedGoodId"
   WHERE pb."id" = NEW."productionBatchId";

  IF batch_row IS NULL OR batch_row."status" <> 'IN_PROGRESS' THEN
    RAISE EXCEPTION 'Production output requires an IN_PROGRESS batch with a finished-good profile.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM "warehouse" WHERE "id" = NEW."destinationWarehouseId" AND "active" = true) THEN
    RAISE EXCEPTION 'Production output destination warehouse must be active.';
  END IF;
  IF NEW."expiryDate" IS NOT NULL AND NEW."expiryDate" < NEW."productionDate" THEN
    RAISE EXCEPTION 'Production output expiry cannot precede production date.';
  END IF;

  IF NEW."outputType" = 'GOOD' THEN
    IF NEW."destinationWarehouseId" <> batch_row."finishedGoodsDestinationWarehouseId" THEN
      RAISE EXCEPTION 'Good output must use the batch finished-goods destination.';
    END IF;
    IF NEW."loosePieces" >= batch_row."piecesPerCarton"
       OR NEW."totalPieces" <> NEW."cartons" * batch_row."piecesPerCarton" + NEW."loosePieces" THEN
      RAISE EXCEPTION 'Good output cartons, loose pieces, and canonical pieces are inconsistent.';
    END IF;
  ELSE
    IF NEW."canonicalUnitId" <> batch_row."productContentCanonicalUnitId"
       OR NEW."canonicalUnitDimension" <> batch_row."productContentCanonicalDimension" THEN
      RAISE EXCEPTION 'Non-good output must use the batch product-content basis.';
    END IF;
    IF length(trim(COALESCE(NEW."notes", ''))) < 3 THEN
      RAISE EXCEPTION 'Non-good output requires explanatory notes.';
    END IF;
  END IF;

  IF TG_OP = 'INSERT' AND NEW."status" <> 'DRAFT' THEN
    RAISE EXCEPTION 'Output must be created as DRAFT.';
  END IF;
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
    ) THEN
      RAISE EXCEPTION 'Posting or cancellation cannot rewrite output draft.';
    END IF;
  END IF;

  IF NEW."status" = 'POSTED' THEN
    IF NEW."postedByUserId" IS NULL OR NEW."postedAt" IS NULL OR NEW."productionLotId" IS NULL THEN
      RAISE EXCEPTION 'Posted output requires actor, timestamp, and production lot.';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM "production_lot"
      WHERE "id" = NEW."productionLotId" AND "productionBatchId" = NEW."productionBatchId"
    ) THEN
      RAISE EXCEPTION 'Posted output requires the production lot owned by its batch.';
    END IF;
    SELECT count(*) INTO movement_count
      FROM "inventory_movement" WHERE "productionOutputTransactionId" = NEW."id";
    IF (NEW."outputType" = 'PROCESS_LOSS' AND movement_count <> 0)
       OR (NEW."outputType" <> 'PROCESS_LOSS' AND movement_count <> 1) THEN
      RAISE EXCEPTION 'Posted output requires its complete inventory effect.';
    END IF;
  END IF;
  IF NEW."status" = 'CANCELLED'
     AND (NEW."cancelledByUserId" IS NULL OR NEW."cancelledAt" IS NULL OR length(trim(NEW."cancellationReason")) = 0) THEN
    RAISE EXCEPTION 'Cancelled output requires actor, timestamp, and reason.';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION validate_production_output_movement()
RETURNS trigger AS $$
DECLARE source_row RECORD;
BEGIN
  IF NEW."movementType" NOT IN ('PRODUCTION_OUTPUT', 'PRODUCTION_REPROCESS_OUTPUT', 'PRODUCTION_REJECTED_OUTPUT') THEN
    RETURN NEW;
  END IF;

  SELECT pot."id", pot."status", pot."outputType", pot."productionBatchId", pot."productionLotId",
         pot."destinationWarehouseId", pot."totalPieces", pot."normalizedQuantity",
         pb."finishedGoodId", pb."productContentCanonicalUnitId", i."stockUnitId"
    INTO source_row
    FROM "production_output_transaction" pot
    JOIN "production_batch" pb ON pb."id" = pot."productionBatchId"
    JOIN "item" i ON i."id" = pb."finishedGoodId"
   WHERE pot."id" = NEW."productionOutputTransactionId";

  IF source_row IS NULL OR source_row."status" <> 'DRAFT' OR NEW."quantity" <= 0
     OR NEW."productionBatchId" <> source_row."productionBatchId"
     OR NEW."productionLotId" <> source_row."productionLotId"
     OR NEW."itemId" <> source_row."finishedGoodId"
     OR NEW."warehouseId" <> source_row."destinationWarehouseId"
     OR NEW."inventoryLotId" IS NOT NULL
     OR NEW."referenceType" <> 'PRODUCTION_OUTPUT_TRANSACTION'
     OR NEW."referenceId" <> source_row."id" THEN
    RAISE EXCEPTION 'Production output movement must preserve its draft output, lot, batch, item, warehouse, and reference.';
  END IF;

  IF NOT (
    (source_row."outputType" = 'GOOD'
      AND NEW."movementType" = 'PRODUCTION_OUTPUT' AND NEW."status" = 'AVAILABLE'
      AND NEW."canonicalUnitId" = source_row."stockUnitId"
      AND NEW."quantity" = source_row."totalPieces")
    OR
    (source_row."outputType" = 'REPROCESS'
      AND NEW."movementType" = 'PRODUCTION_REPROCESS_OUTPUT' AND NEW."status" = 'REPROCESS'
      AND NEW."canonicalUnitId" = source_row."productContentCanonicalUnitId"
      AND NEW."quantity" = source_row."normalizedQuantity")
    OR
    (source_row."outputType" = 'REJECTED'
      AND NEW."movementType" = 'PRODUCTION_REJECTED_OUTPUT' AND NEW."status" = 'SCRAP'
      AND NEW."canonicalUnitId" = source_row."productContentCanonicalUnitId"
      AND NEW."quantity" = source_row."normalizedQuantity")
  ) THEN
    RAISE EXCEPTION 'Production output movement has an invalid type, status, unit, or quantity.';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
