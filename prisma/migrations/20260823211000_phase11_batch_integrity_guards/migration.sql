CREATE OR REPLACE FUNCTION validate_production_batch()
RETURNS trigger AS $$
DECLARE
  recipe_row RECORD;
  material_count INTEGER;
  packaging_count INTEGER;
BEGIN
  SELECT r."version", r."finishedGoodId", r."status"
    INTO recipe_row
    FROM "recipe" r
   WHERE r."id" = NEW."recipeId";

  IF recipe_row IS NULL
     OR recipe_row."version" <> NEW."recipeVersion"
     OR recipe_row."finishedGoodId" <> NEW."finishedGoodId" THEN
    RAISE EXCEPTION 'Production batch must match its exact recipe version and finished good.';
  END IF;

  IF NEW."status" IN ('DRAFT', 'PLANNED', 'RELEASED')
     AND recipe_row."status" <> 'APPROVED' THEN
    RAISE EXCEPTION 'Production planning requires an approved active recipe version.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM unnest(ARRAY[
      NEW."rawMaterialWarehouseId",
      NEW."packagingWarehouseId",
      NEW."finishedGoodsDestinationWarehouseId"
    ]::text[]) warehouse_id
    WHERE NOT EXISTS (
      SELECT 1 FROM "warehouse" w WHERE w."id" = warehouse_id AND w."active" = true
    )
  ) THEN
    RAISE EXCEPTION 'Production batch warehouses must be active.';
  END IF;

  IF TG_OP = 'INSERT' AND NEW."status" <> 'DRAFT' THEN
    RAISE EXCEPTION 'Production batches must be created as DRAFT.';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF OLD."status" = 'DRAFT' AND NEW."status" NOT IN ('DRAFT', 'PLANNED', 'CANCELLED') THEN
      RAISE EXCEPTION 'Invalid production batch transition from DRAFT.';
    ELSIF OLD."status" = 'PLANNED' AND NEW."status" NOT IN ('PLANNED', 'RELEASED', 'CANCELLED') THEN
      RAISE EXCEPTION 'Invalid production batch transition from PLANNED.';
    ELSIF OLD."status" = 'RELEASED' AND NEW."status" NOT IN ('RELEASED', 'CANCELLED') THEN
      RAISE EXCEPTION 'Invalid production batch transition from RELEASED.';
    ELSIF OLD."status" IN ('IN_PROGRESS', 'COMPLETED', 'CANCELLED') AND NEW."status" <> OLD."status" THEN
      RAISE EXCEPTION 'This production batch lifecycle is controlled.';
    END IF;

    IF OLD."status" <> 'DRAFT' AND (
      NEW."recipeId", NEW."recipeVersion", NEW."finishedGoodId",
      NEW."plannedBatchEnteredQuantity", NEW."plannedBatchUnitId",
      NEW."plannedBatchNormalizedQuantity", NEW."plannedBatchCanonicalUnitId",
      NEW."plannedProductionDate", NEW."targetCompletionDate",
      NEW."rawMaterialWarehouseId", NEW."packagingWarehouseId",
      NEW."finishedGoodsDestinationWarehouseId",
      NEW."plannedExpectedOutputNormalizedQuantity", NEW."expectedOutputCanonicalUnitId",
      NEW."expectedYieldPercent", NEW."plannedCartons", NEW."plannedLoosePieces",
      NEW."plannedTotalPieces", NEW."plannedProductContentNormalizedQuantity",
      NEW."productContentCanonicalUnitId", NEW."expectedOutputDifferenceNormalizedQuantity",
      NEW."notes", NEW."createdByUserId"
    ) IS DISTINCT FROM (
      OLD."recipeId", OLD."recipeVersion", OLD."finishedGoodId",
      OLD."plannedBatchEnteredQuantity", OLD."plannedBatchUnitId",
      OLD."plannedBatchNormalizedQuantity", OLD."plannedBatchCanonicalUnitId",
      OLD."plannedProductionDate", OLD."targetCompletionDate",
      OLD."rawMaterialWarehouseId", OLD."packagingWarehouseId",
      OLD."finishedGoodsDestinationWarehouseId",
      OLD."plannedExpectedOutputNormalizedQuantity", OLD."expectedOutputCanonicalUnitId",
      OLD."expectedYieldPercent", OLD."plannedCartons", OLD."plannedLoosePieces",
      OLD."plannedTotalPieces", OLD."plannedProductContentNormalizedQuantity",
      OLD."productContentCanonicalUnitId", OLD."expectedOutputDifferenceNormalizedQuantity",
      OLD."notes", OLD."createdByUserId"
    ) THEN
      RAISE EXCEPTION 'Planned, released, and cancelled production batch plans are immutable.';
    END IF;
  END IF;

  IF NEW."status" = 'PLANNED' THEN
    SELECT count(*) INTO material_count FROM "production_material_requirement" WHERE "productionBatchId" = NEW."id";
    SELECT count(*) INTO packaging_count FROM "production_packaging_requirement" WHERE "productionBatchId" = NEW."id";
    IF material_count = 0 OR material_count <> (SELECT count(*) FROM "recipe_ingredient" WHERE "recipeId" = NEW."recipeId")
       OR packaging_count <> (
         SELECT count(*) FROM "packaging_bom_line" pbl
         JOIN "packaging_bom" pb ON pb."id" = pbl."packagingBomId"
         WHERE pb."recipeId" = NEW."recipeId"
       ) THEN
      RAISE EXCEPTION 'Production batch requirements must completely snapshot the recipe.';
    END IF;
  END IF;

  IF NEW."status" = 'RELEASED' AND (NEW."releasedByUserId" IS NULL OR NEW."releasedAt" IS NULL) THEN
    RAISE EXCEPTION 'Released production batches require actor and timestamp.';
  END IF;
  IF NEW."status" = 'CANCELLED' AND (
    NEW."cancelledByUserId" IS NULL OR NEW."cancelledAt" IS NULL OR length(trim(NEW."cancellationReason")) = 0
  ) THEN
    RAISE EXCEPTION 'Cancelled production batches require actor, timestamp, and reason.';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER production_batch_validate_trg
BEFORE INSERT OR UPDATE ON "production_batch"
FOR EACH ROW EXECUTE FUNCTION validate_production_batch();

CREATE OR REPLACE FUNCTION guard_production_requirement()
RETURNS trigger AS $$
DECLARE
  batch_row RECORD;
  source_row RECORD;
BEGIN
  SELECT "status", "recipeId" INTO batch_row
    FROM "production_batch"
   WHERE "id" = COALESCE(NEW."productionBatchId", OLD."productionBatchId");
  IF batch_row IS NULL OR batch_row."status" <> 'DRAFT' THEN
    RAISE EXCEPTION 'Production requirements may change only while the batch is DRAFT.';
  END IF;

  IF TG_TABLE_NAME = 'production_material_requirement' AND TG_OP <> 'DELETE' THEN
    SELECT ri."recipeId", ri."itemId", ri."normalizedQuantity", ri."allowancePercent",
           ri."canonicalUnitId", ri."canonicalUnitDimension"
      INTO source_row FROM "recipe_ingredient" ri WHERE ri."id" = NEW."recipeIngredientId";
    IF source_row IS NULL OR source_row."recipeId" <> batch_row."recipeId"
       OR source_row."itemId" <> NEW."itemId"
       OR source_row."normalizedQuantity" <> NEW."standardNormalizedQuantity"
       OR source_row."allowancePercent" <> NEW."allowancePercent"
       OR source_row."canonicalUnitId" <> NEW."canonicalUnitId"
       OR source_row."canonicalUnitDimension" <> NEW."canonicalUnitDimension" THEN
      RAISE EXCEPTION 'Raw-material requirement must preserve its recipe-line source.';
    END IF;
  ELSIF TG_TABLE_NAME = 'production_packaging_requirement' AND TG_OP <> 'DELETE' THEN
    SELECT pb."recipeId", pbl."itemId", pbl."usageBasis", pbl."allowancePercent",
           pbl."canonicalUnitId", pbl."canonicalUnitDimension"
      INTO source_row
      FROM "packaging_bom_line" pbl
      JOIN "packaging_bom" pb ON pb."id" = pbl."packagingBomId"
     WHERE pbl."id" = NEW."packagingBomLineId";
    IF source_row IS NULL OR source_row."recipeId" <> batch_row."recipeId"
       OR source_row."itemId" <> NEW."itemId"
       OR source_row."usageBasis" <> NEW."usageBasis"
       OR source_row."allowancePercent" <> NEW."allowancePercent"
       OR source_row."canonicalUnitId" <> NEW."canonicalUnitId"
       OR source_row."canonicalUnitDimension" <> NEW."canonicalUnitDimension" THEN
      RAISE EXCEPTION 'Packaging requirement must preserve its BOM-line source.';
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER production_material_requirement_guard_trg
BEFORE INSERT OR UPDATE OR DELETE ON "production_material_requirement"
FOR EACH ROW EXECUTE FUNCTION guard_production_requirement();

CREATE TRIGGER production_packaging_requirement_guard_trg
BEFORE INSERT OR UPDATE OR DELETE ON "production_packaging_requirement"
FOR EACH ROW EXECUTE FUNCTION guard_production_requirement();

CREATE OR REPLACE FUNCTION prevent_production_batch_delete()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Production batches are retained; cancel instead of deleting.';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER production_batch_no_delete_trg
BEFORE DELETE ON "production_batch"
FOR EACH ROW EXECUTE FUNCTION prevent_production_batch_delete();
