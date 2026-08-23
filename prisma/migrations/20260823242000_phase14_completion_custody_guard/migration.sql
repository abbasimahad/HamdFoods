CREATE OR REPLACE FUNCTION validate_production_batch_completion()
RETURNS trigger AS $$
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

    IF EXISTS (
      SELECT 1
      FROM "inventory_movement"
      WHERE "productionBatchId" = NEW."id" AND "status" = 'IN_PRODUCTION'
      GROUP BY "itemId", "warehouseId", "canonicalUnitId", "inventoryLotId"
      HAVING sum("quantity") <> 0
    ) THEN
      RAISE EXCEPTION 'Batch completion requires zero IN_PRODUCTION custody for every item, warehouse, unit, and lot.';
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM "production_output_transaction"
      WHERE "productionBatchId" = NEW."id" AND "outputType" = 'GOOD' AND "status" = 'POSTED'
    ) THEN
      RAISE EXCEPTION 'Batch completion requires posted good output.';
    END IF;

    IF EXISTS (
      SELECT 1 FROM "production_output_transaction"
      WHERE "productionBatchId" = NEW."id" AND "status" = 'DRAFT'
    ) THEN
      RAISE EXCEPTION 'Batch completion requires all output drafts to be posted or cancelled.';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
