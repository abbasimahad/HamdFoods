CREATE TYPE "ProductionBatchType" AS ENUM ('NORMAL', 'REPROCESS');
CREATE TYPE "ReprocessDocumentStatus" AS ENUM ('DRAFT', 'RESERVED', 'IN_PROGRESS', 'AWAITING_QC', 'RELEASED', 'REJECTED', 'CANCELLED');
CREATE TYPE "ReprocessQcDecisionType" AS ENUM ('APPROVED', 'REJECTED');
CREATE TYPE "WasteDispositionStatus" AS ENUM ('DRAFT', 'POSTED', 'CANCELLED', 'REVERSED');
CREATE TYPE "WasteDispositionAction" AS ENUM ('MOVE_TO_SCRAP', 'MOVE_TO_REPROCESS', 'WRITE_OFF');
CREATE TYPE "WasteDispositionReason" AS ENUM ('DAMAGED', 'EXPIRED', 'SPOILED', 'CONTAMINATED', 'PACKAGING_DAMAGE', 'PRODUCTION_LOSS', 'QUALITY_REJECT', 'HANDLING_DAMAGE', 'OTHER');

ALTER TYPE "AccountingMappingKey" ADD VALUE 'INVENTORY_LOSS_EXPENSE';
ALTER TYPE "AccountingSourceType" ADD VALUE 'REPROCESS_CONSUMPTION';
ALTER TYPE "AccountingSourceType" ADD VALUE 'INVENTORY_WRITE_OFF';
ALTER TYPE "AccountingSourceType" ADD VALUE 'INVENTORY_WRITE_OFF_REVERSAL';
ALTER TYPE "AuditEntityType" ADD VALUE 'REPROCESS_DOCUMENT';
ALTER TYPE "AuditEntityType" ADD VALUE 'WASTE_DISPOSITION';
ALTER TYPE "InventoryMovementType" ADD VALUE 'REPROCESS_RESERVE';
ALTER TYPE "InventoryMovementType" ADD VALUE 'REPROCESS_RESERVATION_RELEASE';
ALTER TYPE "InventoryMovementType" ADD VALUE 'REPROCESS_WIP_IN';
ALTER TYPE "InventoryMovementType" ADD VALUE 'REPROCESS_CONSUMPTION';
ALTER TYPE "InventoryMovementType" ADD VALUE 'REPROCESS_QC_RELEASE';
ALTER TYPE "InventoryMovementType" ADD VALUE 'REPROCESS_QC_REJECT';
ALTER TYPE "InventoryMovementType" ADD VALUE 'WASTE_MOVE_TO_SCRAP';
ALTER TYPE "InventoryMovementType" ADD VALUE 'WASTE_MOVE_TO_REPROCESS';
ALTER TYPE "InventoryMovementType" ADD VALUE 'WASTE_WRITE_OFF';
ALTER TYPE "InventoryMovementType" ADD VALUE 'WASTE_REVERSAL';
ALTER TYPE "InventoryValuationEntryType" ADD VALUE 'REPROCESS_OUTPUT';
ALTER TYPE "InventoryValuationEntryType" ADD VALUE 'REPROCESS_CONSUMPTION';
ALTER TYPE "InventoryValuationEntryType" ADD VALUE 'INVENTORY_WRITE_OFF';
ALTER TYPE "InventoryValuationEntryType" ADD VALUE 'INVENTORY_WRITE_OFF_REVERSAL';

ALTER TABLE "finished_good_profile" ADD COLUMN "reprocessShelfLifeDays" INTEGER;
ALTER TABLE "finished_good_profile" ADD CONSTRAINT "finished_good_profile_reprocess_shelf_life_check"
  CHECK ("reprocessShelfLifeDays" IS NULL OR "reprocessShelfLifeDays" BETWEEN 1 AND 3650);

ALTER TABLE "production_batch" ADD COLUMN "batchType" "ProductionBatchType" NOT NULL DEFAULT 'NORMAL';
ALTER TABLE "production_batch_cost_snapshot" ADD COLUMN "reprocessSourceCost" DECIMAL(30,6) NOT NULL DEFAULT 0;
CREATE INDEX "production_batch_batch_type_status_date_idx"
  ON "production_batch"("batchType", "status", "plannedProductionDate");

CREATE TABLE "reprocess_document" (
  "id" TEXT NOT NULL,
  "documentNumber" TEXT NOT NULL,
  "status" "ReprocessDocumentStatus" NOT NULL DEFAULT 'DRAFT',
  "documentDate" DATE NOT NULL,
  "finishedGoodId" TEXT NOT NULL,
  "finishedGoodType" "ItemType" NOT NULL DEFAULT 'FINISHED_GOOD',
  "sourceWarehouseId" TEXT NOT NULL,
  "linkedProductionBatchId" TEXT NOT NULL,
  "childProductionLotId" TEXT,
  "reason" TEXT NOT NULL,
  "notes" TEXT,
  "shelfLifeDaysSnapshot" INTEGER NOT NULL,
  "sourceExpirySnapshot" DATE NOT NULL,
  "netContentQuantitySnapshot" DECIMAL(18,6) NOT NULL,
  "completionDate" DATE,
  "policyExpiry" DATE,
  "childExpiry" DATE,
  "sourceContentConsumed" DECIMAL(24,6),
  "goodContentOutput" DECIMAL(24,6),
  "scrapContentOutput" DECIMAL(24,6),
  "processLossContent" DECIMAL(24,6),
  "initiatedByUserId" TEXT NOT NULL,
  "completedByUserId" TEXT,
  "cancelledByUserId" TEXT,
  "completedAt" TIMESTAMP(3),
  "cancelledAt" TIMESTAMP(3),
  "cancellationReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "reprocess_document_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "reprocess_document_shelf_life_check" CHECK ("shelfLifeDaysSnapshot" BETWEEN 1 AND 3650),
  CONSTRAINT "reprocess_document_quantity_check" CHECK (
    ("sourceContentConsumed" IS NULL OR "sourceContentConsumed" > 0) AND
    ("goodContentOutput" IS NULL OR "goodContentOutput" >= 0) AND
    ("scrapContentOutput" IS NULL OR "scrapContentOutput" >= 0) AND
    ("processLossContent" IS NULL OR "processLossContent" >= 0)
  ),
  CONSTRAINT "reprocess_document_completion_check" CHECK (
    ("status" NOT IN ('AWAITING_QC', 'RELEASED', 'REJECTED')) OR
    ("completedByUserId" IS NOT NULL AND "completedAt" IS NOT NULL AND "completionDate" IS NOT NULL AND
     "policyExpiry" IS NOT NULL AND "childExpiry" IS NOT NULL AND "childProductionLotId" IS NOT NULL)
  )
);
CREATE UNIQUE INDEX "reprocess_document_number_uidx" ON "reprocess_document"("documentNumber");
CREATE UNIQUE INDEX "reprocess_document_batch_uidx" ON "reprocess_document"("linkedProductionBatchId");
CREATE UNIQUE INDEX "reprocess_document_child_lot_uidx" ON "reprocess_document"("childProductionLotId");
CREATE INDEX "reprocess_document_status_date_idx" ON "reprocess_document"("status", "documentDate");
CREATE INDEX "reprocess_document_finished_good_date_idx" ON "reprocess_document"("finishedGoodId", "documentDate");

CREATE TABLE "waste_disposition" (
  "id" TEXT NOT NULL,
  "documentNumber" TEXT NOT NULL,
  "dispositionDate" DATE NOT NULL,
  "warehouseId" TEXT NOT NULL,
  "status" "WasteDispositionStatus" NOT NULL DEFAULT 'DRAFT',
  "notes" TEXT,
  "createdByUserId" TEXT NOT NULL,
  "postedByUserId" TEXT,
  "postedAt" TIMESTAMP(3),
  "cancelledByUserId" TEXT,
  "cancelledAt" TIMESTAMP(3),
  "cancellationReason" TEXT,
  "reversedByUserId" TEXT,
  "reversedAt" TIMESTAMP(3),
  "reversalReason" TEXT,
  "reversalOfId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "waste_disposition_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "waste_disposition_lifecycle_check" CHECK (
    ("status" <> 'POSTED' OR ("postedByUserId" IS NOT NULL AND "postedAt" IS NOT NULL)) AND
    ("status" <> 'CANCELLED' OR ("cancelledByUserId" IS NOT NULL AND "cancelledAt" IS NOT NULL AND length(trim("cancellationReason")) > 0)) AND
    ("status" <> 'REVERSED' OR ("reversedByUserId" IS NOT NULL AND "reversedAt" IS NOT NULL AND length(trim("reversalReason")) > 0))
  )
);
CREATE UNIQUE INDEX "waste_disposition_number_uidx" ON "waste_disposition"("documentNumber");
CREATE UNIQUE INDEX "waste_disposition_reversal_uidx" ON "waste_disposition"("reversalOfId");
CREATE INDEX "waste_disposition_status_date_idx" ON "waste_disposition"("status", "dispositionDate");
CREATE INDEX "waste_disposition_warehouse_date_idx" ON "waste_disposition"("warehouseId", "dispositionDate");

CREATE TABLE "waste_disposition_line" (
  "id" TEXT NOT NULL,
  "wasteDispositionId" TEXT NOT NULL,
  "position" INTEGER NOT NULL,
  "itemId" TEXT NOT NULL,
  "warehouseId" TEXT NOT NULL,
  "inventoryLotId" TEXT,
  "productionLotId" TEXT,
  "sourceStatus" "InventoryStatus" NOT NULL,
  "enteredQuantity" DECIMAL(24,6) NOT NULL,
  "canonicalUnitId" TEXT NOT NULL,
  "canonicalUnitDimension" "UnitDimension" NOT NULL,
  "action" "WasteDispositionAction" NOT NULL,
  "reason" "WasteDispositionReason" NOT NULL,
  "notes" TEXT,
  "originalValuationEntryId" TEXT,
  "originalAccountingJournalId" TEXT,
  "originalValue" DECIMAL(30,6),
  "originalUnitCost" DECIMAL(30,12),
  CONSTRAINT "waste_disposition_line_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "waste_disposition_line_quantity_check" CHECK ("enteredQuantity" > 0),
  CONSTRAINT "waste_disposition_line_lot_check" CHECK (("inventoryLotId" IS NULL) <> ("productionLotId" IS NULL)),
  CONSTRAINT "waste_disposition_line_other_reason_check" CHECK ("reason" <> 'OTHER' OR length(trim("notes")) > 0),
  CONSTRAINT "waste_disposition_line_action_status_check" CHECK (
    ("action" = 'MOVE_TO_SCRAP' AND "sourceStatus" IN ('DAMAGED', 'QUARANTINE')) OR
    ("action" = 'MOVE_TO_REPROCESS' AND "sourceStatus" IN ('DAMAGED', 'QUARANTINE')) OR
    ("action" = 'WRITE_OFF' AND "sourceStatus" IN ('DAMAGED', 'SCRAP'))
  )
);
CREATE UNIQUE INDEX "waste_disposition_line_position_uidx" ON "waste_disposition_line"("wasteDispositionId", "position");
CREATE INDEX "waste_disposition_line_item_warehouse_status_idx" ON "waste_disposition_line"("itemId", "warehouseId", "sourceStatus");
CREATE INDEX "waste_disposition_line_inventory_lot_idx" ON "waste_disposition_line"("inventoryLotId");
CREATE INDEX "waste_disposition_line_production_lot_idx" ON "waste_disposition_line"("productionLotId");

CREATE TABLE "reprocess_source_contribution" (
  "id" TEXT NOT NULL,
  "reprocessDocumentId" TEXT NOT NULL,
  "sourceProductionLotId" TEXT NOT NULL,
  "sourceInventoryMovementId" TEXT,
  "sourceWasteDispositionLineId" TEXT,
  "position" INTEGER NOT NULL,
  "sourceStatus" "InventoryStatus" NOT NULL,
  "enteredQuantity" DECIMAL(24,6) NOT NULL,
  "enteredUnitId" TEXT NOT NULL,
  "enteredUnitDimension" "UnitDimension" NOT NULL,
  "normalizedContentQuantity" DECIMAL(24,6) NOT NULL,
  "contentCanonicalUnitId" TEXT NOT NULL,
  "contentCanonicalDimension" "UnitDimension" NOT NULL,
  "sourceExpirySnapshot" DATE NOT NULL,
  "reservationGroupId" TEXT,
  "startedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "reprocess_source_contribution_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "reprocess_source_contribution_quantity_check" CHECK ("enteredQuantity" > 0 AND "normalizedContentQuantity" > 0),
  CONSTRAINT "reprocess_source_contribution_status_check" CHECK ("sourceStatus" = 'REPROCESS')
);
CREATE UNIQUE INDEX "reprocess_source_contribution_position_uidx" ON "reprocess_source_contribution"("reprocessDocumentId", "position");
CREATE INDEX "reprocess_source_contribution_source_lot_idx" ON "reprocess_source_contribution"("sourceProductionLotId");
CREATE INDEX "reprocess_source_contribution_source_movement_idx" ON "reprocess_source_contribution"("sourceInventoryMovementId");
CREATE INDEX "reprocess_source_contribution_waste_line_idx" ON "reprocess_source_contribution"("sourceWasteDispositionLineId");

CREATE TABLE "reprocess_qc_decision" (
  "id" TEXT NOT NULL,
  "reprocessDocumentId" TEXT NOT NULL,
  "childProductionLotId" TEXT NOT NULL,
  "decision" "ReprocessQcDecisionType" NOT NULL,
  "rejectionReason" "WasteDispositionReason",
  "notes" TEXT,
  "inspectedByUserId" TEXT NOT NULL,
  "inspectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "reprocess_qc_decision_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "reprocess_qc_decision_reason_check" CHECK (("decision" = 'REJECTED') = ("rejectionReason" IS NOT NULL))
);
CREATE UNIQUE INDEX "reprocess_qc_document_uidx" ON "reprocess_qc_decision"("reprocessDocumentId");
CREATE UNIQUE INDEX "reprocess_qc_child_lot_uidx" ON "reprocess_qc_decision"("childProductionLotId");
CREATE INDEX "reprocess_qc_decision_date_idx" ON "reprocess_qc_decision"("decision", "inspectedAt");

CREATE TABLE "reprocess_document_sequence" ("year" INTEGER NOT NULL, "nextValue" INTEGER NOT NULL, CONSTRAINT "reprocess_document_sequence_pkey" PRIMARY KEY ("year"));
CREATE TABLE "waste_disposition_sequence" ("year" INTEGER NOT NULL, "nextValue" INTEGER NOT NULL, CONSTRAINT "waste_disposition_sequence_pkey" PRIMARY KEY ("year"));

ALTER TABLE "inventory_movement" ADD COLUMN "reprocessSourceContributionId" TEXT, ADD COLUMN "wasteDispositionLineId" TEXT;
CREATE INDEX "inventory_movement_reprocess_contribution_idx" ON "inventory_movement"("reprocessSourceContributionId");
CREATE INDEX "inventory_movement_waste_disposition_line_idx" ON "inventory_movement"("wasteDispositionLineId");

ALTER TABLE "reprocess_document" ADD CONSTRAINT "reprocess_document_finished_good_fkey" FOREIGN KEY ("finishedGoodId", "finishedGoodType") REFERENCES "item"("id", "itemType") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "reprocess_document" ADD CONSTRAINT "reprocess_document_warehouse_fkey" FOREIGN KEY ("sourceWarehouseId") REFERENCES "warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "reprocess_document" ADD CONSTRAINT "reprocess_document_batch_fkey" FOREIGN KEY ("linkedProductionBatchId") REFERENCES "production_batch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "reprocess_document" ADD CONSTRAINT "reprocess_document_child_lot_fkey" FOREIGN KEY ("childProductionLotId") REFERENCES "production_lot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "reprocess_document" ADD CONSTRAINT "reprocess_document_initiated_by_fkey" FOREIGN KEY ("initiatedByUserId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "reprocess_document" ADD CONSTRAINT "reprocess_document_completed_by_fkey" FOREIGN KEY ("completedByUserId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "reprocess_document" ADD CONSTRAINT "reprocess_document_cancelled_by_fkey" FOREIGN KEY ("cancelledByUserId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "waste_disposition" ADD CONSTRAINT "waste_disposition_warehouse_fkey" FOREIGN KEY ("warehouseId") REFERENCES "warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "waste_disposition" ADD CONSTRAINT "waste_disposition_created_by_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "waste_disposition" ADD CONSTRAINT "waste_disposition_posted_by_fkey" FOREIGN KEY ("postedByUserId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "waste_disposition" ADD CONSTRAINT "waste_disposition_cancelled_by_fkey" FOREIGN KEY ("cancelledByUserId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "waste_disposition" ADD CONSTRAINT "waste_disposition_reversed_by_fkey" FOREIGN KEY ("reversedByUserId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "waste_disposition" ADD CONSTRAINT "waste_disposition_reversal_fkey" FOREIGN KEY ("reversalOfId") REFERENCES "waste_disposition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "waste_disposition_line" ADD CONSTRAINT "waste_disposition_line_document_fkey" FOREIGN KEY ("wasteDispositionId") REFERENCES "waste_disposition"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "waste_disposition_line" ADD CONSTRAINT "waste_disposition_line_item_fkey" FOREIGN KEY ("itemId") REFERENCES "item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "waste_disposition_line" ADD CONSTRAINT "waste_disposition_line_warehouse_fkey" FOREIGN KEY ("warehouseId") REFERENCES "warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "waste_disposition_line" ADD CONSTRAINT "waste_disposition_line_inventory_lot_fkey" FOREIGN KEY ("inventoryLotId") REFERENCES "inventory_lot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "waste_disposition_line" ADD CONSTRAINT "waste_disposition_line_production_lot_fkey" FOREIGN KEY ("productionLotId") REFERENCES "production_lot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "waste_disposition_line" ADD CONSTRAINT "waste_disposition_line_unit_fkey" FOREIGN KEY ("canonicalUnitId", "canonicalUnitDimension") REFERENCES "unit"("id", "dimension") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "reprocess_source_contribution" ADD CONSTRAINT "reprocess_source_document_fkey" FOREIGN KEY ("reprocessDocumentId") REFERENCES "reprocess_document"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "reprocess_source_contribution" ADD CONSTRAINT "reprocess_source_lot_fkey" FOREIGN KEY ("sourceProductionLotId") REFERENCES "production_lot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "reprocess_source_contribution" ADD CONSTRAINT "reprocess_source_movement_fkey" FOREIGN KEY ("sourceInventoryMovementId") REFERENCES "inventory_movement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "reprocess_source_contribution" ADD CONSTRAINT "reprocess_source_waste_line_fkey" FOREIGN KEY ("sourceWasteDispositionLineId") REFERENCES "waste_disposition_line"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "reprocess_source_contribution" ADD CONSTRAINT "reprocess_source_entered_unit_fkey" FOREIGN KEY ("enteredUnitId", "enteredUnitDimension") REFERENCES "unit"("id", "dimension") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "reprocess_source_contribution" ADD CONSTRAINT "reprocess_source_content_unit_fkey" FOREIGN KEY ("contentCanonicalUnitId", "contentCanonicalDimension") REFERENCES "unit"("id", "dimension") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "reprocess_qc_decision" ADD CONSTRAINT "reprocess_qc_document_fkey" FOREIGN KEY ("reprocessDocumentId") REFERENCES "reprocess_document"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "reprocess_qc_decision" ADD CONSTRAINT "reprocess_qc_child_lot_fkey" FOREIGN KEY ("childProductionLotId") REFERENCES "production_lot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "reprocess_qc_decision" ADD CONSTRAINT "reprocess_qc_inspector_fkey" FOREIGN KEY ("inspectedByUserId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "inventory_movement" ADD CONSTRAINT "inventory_movement_reprocess_contribution_fkey" FOREIGN KEY ("reprocessSourceContributionId") REFERENCES "reprocess_source_contribution"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "inventory_movement" ADD CONSTRAINT "inventory_movement_waste_line_fkey" FOREIGN KEY ("wasteDispositionLineId") REFERENCES "waste_disposition_line"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION validate_production_output_movement()
RETURNS trigger AS $$
DECLARE source_row RECORD;
BEGIN
  IF NEW."movementType" NOT IN ('PRODUCTION_OUTPUT', 'PRODUCTION_REPROCESS_OUTPUT', 'PRODUCTION_REJECTED_OUTPUT') THEN
    RETURN NEW;
  END IF;
  SELECT pot."id", pot."status", pot."outputType", pot."productionBatchId", pot."productionLotId",
         pot."destinationWarehouseId", pot."totalPieces", pot."normalizedQuantity",
         pb."finishedGoodId", pb."productContentCanonicalUnitId", pb."batchType", i."stockUnitId"
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
      AND NEW."movementType" = 'PRODUCTION_OUTPUT'
      AND ((source_row."batchType" = 'NORMAL' AND NEW."status" = 'AVAILABLE')
        OR (source_row."batchType" = 'REPROCESS' AND NEW."status" = 'QUALITY_HOLD'))
      AND NEW."canonicalUnitId" = source_row."stockUnitId"
      AND NEW."quantity" = source_row."totalPieces")
    OR
    (source_row."outputType" = 'REPROCESS' AND source_row."batchType" = 'NORMAL'
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

CREATE OR REPLACE FUNCTION protect_partial_workflow_history() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION '% rows cannot be deleted', TG_TABLE_NAME;
  END IF;
  IF TG_TABLE_NAME = 'reprocess_qc_decision' THEN
    RAISE EXCEPTION 'posted reprocess QC decisions are immutable';
  END IF;
  IF OLD."status" <> 'DRAFT' THEN
    RAISE EXCEPTION 'posted workflow documents are immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION validate_reprocess_qc_insert() RETURNS trigger AS $$
DECLARE document_row RECORD;
BEGIN
  SELECT "status", "childProductionLotId", "initiatedByUserId", "completedByUserId"
    INTO document_row FROM "reprocess_document" WHERE "id" = NEW."reprocessDocumentId";
  IF document_row IS NULL OR document_row."status" <> 'AWAITING_QC'
     OR document_row."childProductionLotId" <> NEW."childProductionLotId" THEN
    RAISE EXCEPTION 'Reprocess QC must preserve an AWAITING_QC child lot.';
  END IF;
  IF NEW."inspectedByUserId" IN (document_row."initiatedByUserId", document_row."completedByUserId") THEN
    RAISE EXCEPTION 'Another authorized quality user must review this reprocess result.';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER reprocess_qc_insert_guard BEFORE INSERT ON "reprocess_qc_decision"
FOR EACH ROW EXECUTE FUNCTION validate_reprocess_qc_insert();

CREATE TRIGGER reprocess_qc_immutable BEFORE UPDATE OR DELETE ON "reprocess_qc_decision"
FOR EACH ROW EXECUTE FUNCTION protect_partial_workflow_history();

CREATE OR REPLACE FUNCTION validate_reprocess_document_history() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Reprocess documents are retained; cancel before physical start.';
  END IF;
  IF TG_OP = 'INSERT' AND NEW."status" <> 'DRAFT' THEN
    RAISE EXCEPTION 'Reprocess documents must be created as DRAFT.';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF (OLD."status" = 'DRAFT' AND NEW."status" NOT IN ('DRAFT', 'RESERVED', 'CANCELLED'))
      OR (OLD."status" = 'RESERVED' AND NEW."status" NOT IN ('RESERVED', 'IN_PROGRESS', 'CANCELLED'))
      OR (OLD."status" = 'IN_PROGRESS' AND NEW."status" NOT IN ('IN_PROGRESS', 'AWAITING_QC'))
      OR (OLD."status" = 'AWAITING_QC' AND NEW."status" NOT IN ('AWAITING_QC', 'RELEASED', 'REJECTED'))
      OR (OLD."status" IN ('RELEASED', 'REJECTED', 'CANCELLED') AND NEW."status" <> OLD."status") THEN
      RAISE EXCEPTION 'Invalid Reprocess document lifecycle transition.';
    END IF;
    IF OLD."status" <> 'DRAFT' AND (
      NEW."documentNumber", NEW."documentDate", NEW."finishedGoodId", NEW."finishedGoodType",
      NEW."sourceWarehouseId", NEW."linkedProductionBatchId", NEW."reason", NEW."notes",
      NEW."shelfLifeDaysSnapshot", NEW."sourceExpirySnapshot", NEW."netContentQuantitySnapshot",
      NEW."initiatedByUserId"
    ) IS DISTINCT FROM (
      OLD."documentNumber", OLD."documentDate", OLD."finishedGoodId", OLD."finishedGoodType",
      OLD."sourceWarehouseId", OLD."linkedProductionBatchId", OLD."reason", OLD."notes",
      OLD."shelfLifeDaysSnapshot", OLD."sourceExpirySnapshot", OLD."netContentQuantitySnapshot",
      OLD."initiatedByUserId"
    ) THEN
      RAISE EXCEPTION 'Reserved Reprocess source and policy snapshots are immutable.';
    END IF;
    IF OLD."childProductionLotId" IS NOT NULL
       AND NEW."childProductionLotId" IS DISTINCT FROM OLD."childProductionLotId" THEN
      RAISE EXCEPTION 'Posted Reprocess child-lot genealogy is immutable.';
    END IF;
    IF OLD."status" IN ('AWAITING_QC', 'RELEASED', 'REJECTED') AND (
      NEW."childProductionLotId", NEW."completionDate", NEW."policyExpiry", NEW."childExpiry",
      NEW."sourceContentConsumed", NEW."goodContentOutput", NEW."scrapContentOutput",
      NEW."processLossContent", NEW."completedByUserId", NEW."completedAt"
    ) IS DISTINCT FROM (
      OLD."childProductionLotId", OLD."completionDate", OLD."policyExpiry", OLD."childExpiry",
      OLD."sourceContentConsumed", OLD."goodContentOutput", OLD."scrapContentOutput",
      OLD."processLossContent", OLD."completedByUserId", OLD."completedAt"
    ) THEN
      RAISE EXCEPTION 'Completed Reprocess genealogy, dates, and yield are immutable.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER reprocess_document_history_guard
BEFORE INSERT OR UPDATE OR DELETE ON "reprocess_document"
FOR EACH ROW EXECUTE FUNCTION validate_reprocess_document_history();

CREATE OR REPLACE FUNCTION validate_reprocess_source_history() RETURNS trigger AS $$
DECLARE document_status "ReprocessDocumentStatus";
BEGIN
  SELECT "status" INTO document_status FROM "reprocess_document"
   WHERE "id" = COALESCE(NEW."reprocessDocumentId", OLD."reprocessDocumentId");
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Reprocess source genealogy is retained.';
  END IF;
  IF TG_OP = 'INSERT' AND document_status <> 'DRAFT' THEN
    RAISE EXCEPTION 'Reprocess source genealogy may be added only in DRAFT.';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF (
      NEW."reprocessDocumentId", NEW."sourceProductionLotId", NEW."sourceInventoryMovementId",
      NEW."sourceWasteDispositionLineId", NEW."position", NEW."sourceStatus",
      NEW."enteredQuantity", NEW."enteredUnitId", NEW."enteredUnitDimension",
      NEW."normalizedContentQuantity", NEW."contentCanonicalUnitId",
      NEW."contentCanonicalDimension", NEW."sourceExpirySnapshot", NEW."createdAt"
    ) IS DISTINCT FROM (
      OLD."reprocessDocumentId", OLD."sourceProductionLotId", OLD."sourceInventoryMovementId",
      OLD."sourceWasteDispositionLineId", OLD."position", OLD."sourceStatus",
      OLD."enteredQuantity", OLD."enteredUnitId", OLD."enteredUnitDimension",
      OLD."normalizedContentQuantity", OLD."contentCanonicalUnitId",
      OLD."contentCanonicalDimension", OLD."sourceExpirySnapshot", OLD."createdAt"
    ) THEN
      RAISE EXCEPTION 'Reprocess source genealogy is immutable.';
    END IF;
    IF OLD."reservationGroupId" IS NOT NULL
       AND NEW."reservationGroupId" IS DISTINCT FROM OLD."reservationGroupId" THEN
      RAISE EXCEPTION 'Reprocess reservation provenance is immutable.';
    END IF;
    IF OLD."startedAt" IS NOT NULL AND NEW."startedAt" IS DISTINCT FROM OLD."startedAt" THEN
      RAISE EXCEPTION 'Reprocess start provenance is immutable.';
    END IF;
    IF NEW."reservationGroupId" IS DISTINCT FROM OLD."reservationGroupId" AND document_status <> 'DRAFT' THEN
      RAISE EXCEPTION 'Reservation provenance may be set only while reserving a DRAFT.';
    END IF;
    IF NEW."startedAt" IS DISTINCT FROM OLD."startedAt" AND document_status <> 'RESERVED' THEN
      RAISE EXCEPTION 'Start provenance may be set only from RESERVED custody.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER reprocess_source_history_guard
BEFORE INSERT OR UPDATE OR DELETE ON "reprocess_source_contribution"
FOR EACH ROW EXECUTE FUNCTION validate_reprocess_source_history();

CREATE OR REPLACE FUNCTION validate_waste_disposition_history() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Waste disposition documents are retained.';
  END IF;
  IF TG_OP = 'INSERT' AND NEW."status" <> 'DRAFT' THEN
    RAISE EXCEPTION 'Waste dispositions must be created as DRAFT.';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF OLD."status" = 'POSTED' AND NEW."status" = 'REVERSED' THEN
      IF ROW(NEW."documentNumber", NEW."dispositionDate", NEW."warehouseId", NEW."notes",
             NEW."createdByUserId", NEW."postedByUserId", NEW."postedAt", NEW."cancelledByUserId",
             NEW."cancelledAt", NEW."cancellationReason", NEW."reversalOfId")
         IS DISTINCT FROM
         ROW(OLD."documentNumber", OLD."dispositionDate", OLD."warehouseId", OLD."notes",
             OLD."createdByUserId", OLD."postedByUserId", OLD."postedAt", OLD."cancelledByUserId",
             OLD."cancelledAt", OLD."cancellationReason", OLD."reversalOfId") THEN
        RAISE EXCEPTION 'Reversal may not edit the original Waste disposition.';
      END IF;
      RETURN NEW;
    END IF;
    IF OLD."status" <> 'DRAFT' THEN
      RAISE EXCEPTION 'Posted or cancelled Waste dispositions are immutable.';
    END IF;
    IF NEW."status" NOT IN ('DRAFT', 'POSTED', 'CANCELLED') THEN
      RAISE EXCEPTION 'Waste disposition lifecycle transition is invalid.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER waste_disposition_history_guard
BEFORE INSERT OR UPDATE OR DELETE ON "waste_disposition"
FOR EACH ROW EXECUTE FUNCTION validate_waste_disposition_history();

CREATE OR REPLACE FUNCTION validate_waste_disposition_line_history() RETURNS trigger AS $$
DECLARE document_status "WasteDispositionStatus";
BEGIN
  SELECT "status" INTO document_status FROM "waste_disposition"
   WHERE "id" = COALESCE(NEW."wasteDispositionId", OLD."wasteDispositionId");
  IF document_status <> 'DRAFT' THEN
    RAISE EXCEPTION 'Posted or cancelled Waste disposition lines are immutable.';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER waste_disposition_line_history_guard
BEFORE INSERT OR UPDATE OR DELETE ON "waste_disposition_line"
FOR EACH ROW EXECUTE FUNCTION validate_waste_disposition_line_history();
