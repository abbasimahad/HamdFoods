CREATE OR REPLACE FUNCTION enforce_recipe_lifecycle() RETURNS trigger AS $$
DECLARE invalid_reference_count INTEGER;
BEGIN
  IF OLD."status" <> 'DRAFT' AND (
    NEW."code" <> OLD."code" OR NEW."name" <> OLD."name"
    OR NEW."finishedGoodId" <> OLD."finishedGoodId" OR NEW."finishedGoodType" <> OLD."finishedGoodType"
    OR NEW."version" <> OLD."version"
    OR NEW."standardBatchEnteredQuantity" <> OLD."standardBatchEnteredQuantity"
    OR NEW."standardBatchUnitId" <> OLD."standardBatchUnitId"
    OR NEW."standardBatchUnitDimension" <> OLD."standardBatchUnitDimension"
    OR NEW."standardBatchNormalizedQuantity" <> OLD."standardBatchNormalizedQuantity"
    OR NEW."standardBatchCanonicalUnitId" <> OLD."standardBatchCanonicalUnitId"
    OR NEW."standardBatchCanonicalDimension" <> OLD."standardBatchCanonicalDimension"
    OR NEW."expectedOutputEnteredQuantity" IS DISTINCT FROM OLD."expectedOutputEnteredQuantity"
    OR NEW."expectedOutputUnitId" IS DISTINCT FROM OLD."expectedOutputUnitId"
    OR NEW."expectedOutputUnitDimension" IS DISTINCT FROM OLD."expectedOutputUnitDimension"
    OR NEW."expectedOutputNormalizedQuantity" IS DISTINCT FROM OLD."expectedOutputNormalizedQuantity"
    OR NEW."expectedOutputCanonicalUnitId" IS DISTINCT FROM OLD."expectedOutputCanonicalUnitId"
    OR NEW."expectedOutputCanonicalDimension" IS DISTINCT FROM OLD."expectedOutputCanonicalDimension"
    OR NEW."notes" IS DISTINCT FROM OLD."notes" OR NEW."effectiveDate" IS DISTINCT FROM OLD."effectiveDate"
    OR NEW."createdByUserId" <> OLD."createdByUserId"
    OR NEW."approvedByUserId" IS DISTINCT FROM OLD."approvedByUserId"
    OR NEW."approvedAt" IS DISTINCT FROM OLD."approvedAt"
  ) THEN RAISE EXCEPTION 'Approved or inactive recipe versions are immutable'; END IF;

  IF NOT (
    (OLD."status" = 'DRAFT' AND NEW."status" IN ('DRAFT','APPROVED'))
    OR (OLD."status" = 'APPROVED' AND NEW."status" IN ('APPROVED','INACTIVE'))
    OR (OLD."status" = 'INACTIVE' AND NEW."status" = 'INACTIVE')
  ) THEN RAISE EXCEPTION 'Invalid recipe status transition'; END IF;

  IF OLD."status" = 'DRAFT' AND NEW."status" = 'APPROVED' THEN
    IF NOT EXISTS (SELECT 1 FROM "item" WHERE "id" = NEW."finishedGoodId" AND "itemType" = 'FINISHED_GOOD' AND "active")
       OR NOT EXISTS (SELECT 1 FROM "unit" WHERE "id" = NEW."standardBatchUnitId" AND "active")
       OR NOT EXISTS (SELECT 1 FROM "recipe_ingredient" WHERE "recipeId" = NEW."id") THEN
      RAISE EXCEPTION 'Recipe approval requires an active finished good, active batch unit, and ingredients';
    END IF;
    SELECT COUNT(*) INTO invalid_reference_count FROM "recipe_ingredient" ri
      LEFT JOIN "item" i ON i."id" = ri."itemId"
      LEFT JOIN "unit" u ON u."id" = ri."enteredUnitId"
      WHERE ri."recipeId" = NEW."id" AND (i."active" IS DISTINCT FROM TRUE OR i."itemType" <> 'RAW_MATERIAL' OR u."active" IS DISTINCT FROM TRUE);
    IF invalid_reference_count > 0 THEN RAISE EXCEPTION 'Recipe contains inactive or invalid ingredient references'; END IF;
    SELECT COUNT(*) INTO invalid_reference_count FROM "packaging_bom_line" pbl
      JOIN "packaging_bom" pb ON pb."id" = pbl."packagingBomId"
      LEFT JOIN "item" i ON i."id" = pbl."itemId"
      LEFT JOIN "unit" u ON u."id" = pbl."enteredUnitId"
      WHERE pb."recipeId" = NEW."id" AND (i."active" IS DISTINCT FROM TRUE OR i."itemType" <> 'PACKAGING_MATERIAL' OR u."active" IS DISTINCT FROM TRUE);
    IF invalid_reference_count > 0 THEN RAISE EXCEPTION 'Recipe contains inactive or invalid packaging references'; END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER recipe_lifecycle_guard BEFORE UPDATE ON "recipe"
FOR EACH ROW EXECUTE FUNCTION enforce_recipe_lifecycle();

CREATE OR REPLACE FUNCTION enforce_recipe_ingredient_mutation() RETURNS trigger AS $$
DECLARE parent_status "RecipeStatus";
DECLARE parent_id TEXT;
BEGIN
  parent_id := CASE WHEN TG_OP = 'DELETE' THEN OLD."recipeId" ELSE NEW."recipeId" END;
  SELECT "status" INTO parent_status FROM "recipe" WHERE "id" = parent_id;
  IF parent_status <> 'DRAFT' THEN RAISE EXCEPTION 'Only draft recipe ingredients may change'; END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER recipe_ingredient_mutation_guard BEFORE INSERT OR UPDATE OR DELETE ON "recipe_ingredient"
FOR EACH ROW EXECUTE FUNCTION enforce_recipe_ingredient_mutation();

CREATE OR REPLACE FUNCTION enforce_packaging_bom_mutation() RETURNS trigger AS $$
DECLARE parent_status "RecipeStatus";
DECLARE parent_recipe_id TEXT;
BEGIN
  parent_recipe_id := CASE WHEN TG_OP = 'DELETE' THEN OLD."recipeId" ELSE NEW."recipeId" END;
  SELECT "status" INTO parent_status FROM "recipe" WHERE "id" = parent_recipe_id;
  IF parent_status <> 'DRAFT' THEN RAISE EXCEPTION 'Only draft packaging BOMs may change'; END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER packaging_bom_mutation_guard BEFORE INSERT OR UPDATE OR DELETE ON "packaging_bom"
FOR EACH ROW EXECUTE FUNCTION enforce_packaging_bom_mutation();

CREATE OR REPLACE FUNCTION enforce_packaging_bom_line_mutation() RETURNS trigger AS $$
DECLARE parent_status "RecipeStatus";
DECLARE bom_id TEXT;
BEGIN
  bom_id := CASE WHEN TG_OP = 'DELETE' THEN OLD."packagingBomId" ELSE NEW."packagingBomId" END;
  SELECT r."status" INTO parent_status FROM "packaging_bom" pb JOIN "recipe" r ON r."id" = pb."recipeId" WHERE pb."id" = bom_id;
  IF parent_status <> 'DRAFT' THEN RAISE EXCEPTION 'Only draft packaging BOM lines may change'; END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER packaging_bom_line_mutation_guard BEFORE INSERT OR UPDATE OR DELETE ON "packaging_bom_line"
FOR EACH ROW EXECUTE FUNCTION enforce_packaging_bom_line_mutation();
