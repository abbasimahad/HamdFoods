ALTER TYPE "InventoryMovementType" ADD VALUE IF NOT EXISTS 'PACKAGING_ISSUE';
ALTER TYPE "InventoryMovementType" ADD VALUE IF NOT EXISTS 'PACKAGING_RETURN';
ALTER TYPE "InventoryMovementType" ADD VALUE IF NOT EXISTS 'PACKAGING_DAMAGE';
ALTER TYPE "ProductionMaterialTransactionType" ADD VALUE IF NOT EXISTS 'DAMAGE';

DO $$ BEGIN
  CREATE TYPE "PackagingDamageReason" AS ENUM (
    'BROKEN', 'CRUSHED', 'TORN', 'MACHINE_SETUP', 'PRINT_DEFECT',
    'FILLING_DAMAGE', 'HANDLING_DAMAGE', 'OTHER'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "production_material_transaction"
  ADD COLUMN IF NOT EXISTS "materialType" "ItemType" NOT NULL DEFAULT 'RAW_MATERIAL',
  ADD COLUMN IF NOT EXISTS "damageReason" "PackagingDamageReason";

ALTER TABLE "production_material_transaction_line"
  ALTER COLUMN "batchRequirementId" DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS "packagingRequirementId" TEXT;

ALTER TABLE "production_material_transaction_sequence"
  ADD COLUMN IF NOT EXISTS "materialType" "ItemType" NOT NULL DEFAULT 'RAW_MATERIAL';
ALTER TABLE "production_material_transaction_sequence"
  DROP CONSTRAINT IF EXISTS "production_material_transaction_sequence_pkey";
ALTER TABLE "production_material_transaction_sequence"
  ADD CONSTRAINT "production_material_transaction_sequence_pkey"
  PRIMARY KEY ("materialType", "transactionType", "year");

DROP INDEX IF EXISTS "production_material_transaction_type_status_date_idx";
CREATE INDEX IF NOT EXISTS "production_material_transaction_materialType_transactionType_status_transactionDate_idx"
  ON "production_material_transaction"("materialType", "transactionType", "status", "transactionDate");
CREATE INDEX "production_material_transaction_line_packagingRequirementId_idx"
  ON "production_material_transaction_line"("packagingRequirementId");

ALTER TABLE "production_material_transaction_line"
  ADD CONSTRAINT "production_material_transaction_line_packagingRequirementId_fkey"
  FOREIGN KEY ("packagingRequirementId") REFERENCES "production_packaging_requirement"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "production_material_transaction"
  ADD CONSTRAINT "production_material_transaction_material_type_ck"
  CHECK ("materialType" IN ('RAW_MATERIAL', 'PACKAGING_MATERIAL')),
  ADD CONSTRAINT "production_material_transaction_damage_reason_ck"
  CHECK (("transactionType" = 'DAMAGE') = ("damageReason" IS NOT NULL));

ALTER TABLE "production_material_transaction_line"
  ADD CONSTRAINT "production_material_transaction_line_requirement_kind_ck"
  CHECK (("batchRequirementId" IS NOT NULL)::integer + ("packagingRequirementId" IS NOT NULL)::integer = 1);
