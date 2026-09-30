-- BUG-31: a posted material issue or consumption could never be corrected, so a wrong item or
-- quantity stayed in batch cost. A correction is now a separate POSTED reversal document that
-- points at the original (which stays POSTED and immutable) and posts mirror-image ledger,
-- valuation and journal entries. Only issues and consumptions of a batch that is still open can
-- be reversed; each original can be reversed at most once.
ALTER TABLE "production_material_transaction" ADD COLUMN "reversalOfId" TEXT;
CREATE UNIQUE INDEX "production_material_transaction_reversalOfId_key" ON "production_material_transaction"("reversalOfId");
ALTER TABLE "production_material_transaction" ADD CONSTRAINT "production_material_transaction_reversalOfId_fkey" FOREIGN KEY ("reversalOfId") REFERENCES "production_material_transaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "production_material_transaction" ADD CONSTRAINT "production_material_transaction_reversal_self_ck" CHECK ("reversalOfId" IS NULL OR "reversalOfId" <> "id");

CREATE OR REPLACE FUNCTION validate_production_material_transaction()
RETURNS trigger AS $$
DECLARE
  batch_status "ProductionBatchStatus";
  line_count integer;
  movement_count integer;
  original_row RECORD;
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
  IF NEW."reversalOfId" IS NOT NULL THEN
    SELECT "status", "productionBatchId", "materialType", "transactionType", "reversalOfId"
      INTO original_row FROM "production_material_transaction" WHERE "id" = NEW."reversalOfId";
    IF original_row IS NULL OR original_row."status" <> 'POSTED' OR original_row."reversalOfId" IS NOT NULL
       OR original_row."productionBatchId" <> NEW."productionBatchId"
       OR original_row."materialType" <> NEW."materialType"
       OR original_row."transactionType" <> NEW."transactionType"
       OR NEW."transactionType" NOT IN ('ISSUE', 'CONSUMPTION') THEN
      RAISE EXCEPTION 'A reversal must mirror one POSTED, unreversed issue or consumption of the same batch.';
    END IF;
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
      NEW."damageReason", NEW."transactionDate", NEW."notes", NEW."createdByUserId", NEW."reversalOfId"
    ) IS DISTINCT FROM (
      OLD."transactionNumber", OLD."productionBatchId", OLD."materialType", OLD."transactionType",
      OLD."damageReason", OLD."transactionDate", OLD."notes", OLD."createdByUserId", OLD."reversalOfId"
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

CREATE OR REPLACE FUNCTION validate_production_inventory_movement()
RETURNS trigger AS $$
DECLARE source_row RECORD;
BEGIN
  IF NEW."movementType" NOT IN (
    'PRODUCTION_ISSUE', 'PRODUCTION_RETURN', 'PRODUCTION_CONSUMPTION',
    'PACKAGING_ISSUE', 'PACKAGING_RETURN', 'PACKAGING_CONSUMPTION', 'PACKAGING_DAMAGE'
  ) THEN RETURN NEW; END IF;
  SELECT pmtl."itemId", pmtl."inventoryLotId", pmtl."canonicalUnitId",
         pmt."id" AS transaction_id, pmt."productionBatchId", pmt."materialType", pmt."transactionType",
         pmt."reversalOfId" IS NOT NULL AS is_reversal
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
  IF source_row.is_reversal THEN
    -- A reversal mirrors its original: an issue reversal moves batch custody back to AVAILABLE,
    -- a consumption reversal restores the consumed quantity to batch custody.
    IF NOT (
      (source_row."transactionType" = 'ISSUE'
        AND NEW."movementType" IN ('PRODUCTION_ISSUE', 'PACKAGING_ISSUE')
        AND (NEW."movementType" = 'PRODUCTION_ISSUE') = (source_row."materialType" = 'RAW_MATERIAL')
        AND ((NEW."status" = 'IN_PRODUCTION' AND NEW."quantity" < 0) OR (NEW."status" = 'AVAILABLE' AND NEW."quantity" > 0))) OR
      (source_row."transactionType" = 'CONSUMPTION'
        AND NEW."movementType" IN ('PRODUCTION_CONSUMPTION', 'PACKAGING_CONSUMPTION')
        AND (NEW."movementType" = 'PRODUCTION_CONSUMPTION') = (source_row."materialType" = 'RAW_MATERIAL')
        AND NEW."status" = 'IN_PRODUCTION' AND NEW."quantity" > 0)
    ) THEN RAISE EXCEPTION 'Reversal movement does not mirror its original material operation.'; END IF;
    RETURN NEW;
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
