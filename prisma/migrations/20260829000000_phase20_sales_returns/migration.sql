CREATE TYPE "SalesReturnStatus" AS ENUM ('DRAFT', 'RECEIVED', 'INSPECTED', 'COMPLETED', 'CANCELLED');
CREATE TYPE "SalesReturnType" AS ENUM ('INVOICED_RETURN', 'DISPATCH_REFUSAL');
CREATE TYPE "SalesReturnReason" AS ENUM ('CUSTOMER_REJECTION', 'WRONG_PRODUCT', 'WRONG_QUANTITY', 'DAMAGED_IN_TRANSIT', 'PRODUCT_DEFECT', 'PACKAGING_DEFECT', 'EXPIRED', 'SHORT_EXPIRY', 'QUALITY_COMPLAINT', 'ORDER_CANCELLED', 'OTHER');
CREATE TYPE "SalesReturnInspectionClassification" AS ENUM ('GOOD_RESALE', 'QUARANTINE', 'REPROCESS', 'DAMAGED', 'EXPIRED');

-- SALES_INVOICE_OUT corrects the Phase 18 enum gap in the live database.
ALTER TYPE "InventoryMovementType" ADD VALUE 'SALES_INVOICE_OUT';
ALTER TYPE "InventoryMovementType" ADD VALUE 'SALES_RETURN_RECEIPT';
ALTER TYPE "InventoryMovementType" ADD VALUE 'RETURN_TO_AVAILABLE';
ALTER TYPE "InventoryMovementType" ADD VALUE 'RETURN_TO_QUARANTINE';
ALTER TYPE "InventoryMovementType" ADD VALUE 'RETURN_TO_REPROCESS';
ALTER TYPE "InventoryMovementType" ADD VALUE 'RETURN_TO_DAMAGED';
ALTER TYPE "InventoryMovementType" ADD VALUE 'RETURN_TO_EXPIRED';
ALTER TYPE "InventoryMovementType" ADD VALUE 'DISPATCH_REFUSAL_RETURN';
ALTER TYPE "InventoryStatus" ADD VALUE 'RETURN_INSPECTION';

ALTER TABLE "customer_ledger_entry" ADD COLUMN "salesReturnId" TEXT;
ALTER TABLE "inventory_movement" ADD COLUMN "salesReturnId" TEXT;
ALTER TABLE "inventory_movement" ADD COLUMN "salesReturnLineId" TEXT;
ALTER TABLE "inventory_movement" ADD COLUMN "salesReturnInspectionId" TEXT;

CREATE TABLE "sales_return" (
  "id" TEXT NOT NULL,
  "number" TEXT NOT NULL,
  "type" "SalesReturnType" NOT NULL,
  "customerId" TEXT NOT NULL,
  "salesInvoiceId" TEXT,
  "salesOrderId" TEXT NOT NULL,
  "salesDispatchId" TEXT NOT NULL,
  "receivingWarehouseId" TEXT NOT NULL,
  "returnAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "status" "SalesReturnStatus" NOT NULL DEFAULT 'DRAFT',
  "customerReference" TEXT,
  "notes" TEXT,
  "createdByUserId" TEXT NOT NULL,
  "receivedByUserId" TEXT,
  "receivedAt" TIMESTAMP(3),
  "inspectedByUserId" TEXT,
  "inspectedAt" TIMESTAMP(3),
  "completedByUserId" TEXT,
  "completedAt" TIMESTAMP(3),
  "cancelledByUserId" TEXT,
  "cancelledAt" TIMESTAMP(3),
  "cancellationReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "sales_return_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "sales_return_line" (
  "id" TEXT NOT NULL,
  "salesReturnId" TEXT NOT NULL,
  "salesInvoiceLineId" TEXT,
  "salesDispatchLineId" TEXT NOT NULL,
  "salesDispatchAllocationId" TEXT NOT NULL,
  "productionLotId" TEXT NOT NULL,
  "itemId" TEXT NOT NULL,
  "canonicalUnitId" TEXT NOT NULL,
  "cartons" INTEGER NOT NULL,
  "loosePieces" INTEGER NOT NULL,
  "totalPieces" DECIMAL(24,6) NOT NULL,
  "reason" "SalesReturnReason" NOT NULL,
  "notes" TEXT,
  "cartonRate" DECIMAL(24,6),
  "pieceRate" DECIMAL(24,6),
  "discount1Percent" DECIMAL(7,4),
  "discount2Percent" DECIMAL(7,4),
  "taxPercent" DECIMAL(7,4),
  "grossAmount" DECIMAL(24,6),
  "discountAmount" DECIMAL(24,6),
  "taxAmount" DECIMAL(24,6),
  "netAmount" DECIMAL(24,6),
  CONSTRAINT "sales_return_line_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "sales_return_line_quantity" CHECK ("cartons" >= 0 AND "loosePieces" >= 0 AND "totalPieces" > 0)
);

CREATE TABLE "sales_return_inspection" (
  "id" TEXT NOT NULL,
  "salesReturnLineId" TEXT NOT NULL,
  "classification" "SalesReturnInspectionClassification" NOT NULL,
  "quantity" DECIMAL(24,6) NOT NULL,
  "reason" TEXT,
  "notes" TEXT,
  "createdByUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "sales_return_inspection_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "sales_return_inspection_quantity" CHECK ("quantity" > 0)
);

CREATE TABLE "sales_return_sequence" (
  "year" INTEGER NOT NULL,
  "nextValue" INTEGER NOT NULL,
  CONSTRAINT "sales_return_sequence_pkey" PRIMARY KEY ("year")
);

CREATE UNIQUE INDEX "sales_return_number_key" ON "sales_return"("number");
CREATE INDEX "sales_return_customerId_returnAt_idx" ON "sales_return"("customerId", "returnAt");
CREATE INDEX "sales_return_salesInvoiceId_returnAt_idx" ON "sales_return"("salesInvoiceId", "returnAt");
CREATE INDEX "sales_return_status_returnAt_idx" ON "sales_return"("status", "returnAt");
CREATE INDEX "sales_return_line_salesInvoiceLineId_idx" ON "sales_return_line"("salesInvoiceLineId");
CREATE INDEX "sales_return_line_salesDispatchAllocationId_idx" ON "sales_return_line"("salesDispatchAllocationId");
CREATE INDEX "sales_return_inspection_salesReturnLineId_idx" ON "sales_return_inspection"("salesReturnLineId");
CREATE UNIQUE INDEX "sales_return_inspection_salesReturnLineId_classification_key" ON "sales_return_inspection"("salesReturnLineId", "classification");
CREATE UNIQUE INDEX "customer_ledger_entry_salesReturnId_key" ON "customer_ledger_entry"("salesReturnId");
CREATE INDEX "inventory_movement_salesReturnId_status_postedAt_idx" ON "inventory_movement"("salesReturnId", "status", "postedAt");
CREATE INDEX "inventory_movement_salesReturnLineId_idx" ON "inventory_movement"("salesReturnLineId");
CREATE INDEX "inventory_movement_salesReturnInspectionId_idx" ON "inventory_movement"("salesReturnInspectionId");

ALTER TABLE "customer_ledger_entry" ADD CONSTRAINT "customer_ledger_entry_salesReturnId_fkey" FOREIGN KEY ("salesReturnId") REFERENCES "sales_return"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "inventory_movement" ADD CONSTRAINT "inventory_movement_salesReturnId_fkey" FOREIGN KEY ("salesReturnId") REFERENCES "sales_return"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "inventory_movement" ADD CONSTRAINT "inventory_movement_salesReturnLineId_fkey" FOREIGN KEY ("salesReturnLineId") REFERENCES "sales_return_line"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "inventory_movement" ADD CONSTRAINT "inventory_movement_salesReturnInspectionId_fkey" FOREIGN KEY ("salesReturnInspectionId") REFERENCES "sales_return_inspection"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sales_return" ADD CONSTRAINT "sales_return_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sales_return" ADD CONSTRAINT "sales_return_salesInvoiceId_fkey" FOREIGN KEY ("salesInvoiceId") REFERENCES "sales_invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sales_return" ADD CONSTRAINT "sales_return_salesOrderId_fkey" FOREIGN KEY ("salesOrderId") REFERENCES "sales_order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sales_return" ADD CONSTRAINT "sales_return_salesDispatchId_fkey" FOREIGN KEY ("salesDispatchId") REFERENCES "sales_dispatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sales_return" ADD CONSTRAINT "sales_return_receivingWarehouseId_fkey" FOREIGN KEY ("receivingWarehouseId") REFERENCES "warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sales_return" ADD CONSTRAINT "sales_return_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sales_return" ADD CONSTRAINT "sales_return_receivedByUserId_fkey" FOREIGN KEY ("receivedByUserId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sales_return" ADD CONSTRAINT "sales_return_inspectedByUserId_fkey" FOREIGN KEY ("inspectedByUserId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sales_return" ADD CONSTRAINT "sales_return_completedByUserId_fkey" FOREIGN KEY ("completedByUserId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sales_return" ADD CONSTRAINT "sales_return_cancelledByUserId_fkey" FOREIGN KEY ("cancelledByUserId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sales_return_line" ADD CONSTRAINT "sales_return_line_salesReturnId_fkey" FOREIGN KEY ("salesReturnId") REFERENCES "sales_return"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "sales_return_line" ADD CONSTRAINT "sales_return_line_salesInvoiceLineId_fkey" FOREIGN KEY ("salesInvoiceLineId") REFERENCES "sales_invoice_line"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sales_return_line" ADD CONSTRAINT "sales_return_line_salesDispatchLineId_fkey" FOREIGN KEY ("salesDispatchLineId") REFERENCES "sales_dispatch_line"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sales_return_line" ADD CONSTRAINT "sales_return_line_salesDispatchAllocationId_fkey" FOREIGN KEY ("salesDispatchAllocationId") REFERENCES "sales_dispatch_lot_allocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sales_return_line" ADD CONSTRAINT "sales_return_line_productionLotId_fkey" FOREIGN KEY ("productionLotId") REFERENCES "production_lot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sales_return_line" ADD CONSTRAINT "sales_return_line_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sales_return_line" ADD CONSTRAINT "sales_return_line_canonicalUnitId_fkey" FOREIGN KEY ("canonicalUnitId") REFERENCES "unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sales_return_inspection" ADD CONSTRAINT "sales_return_inspection_salesReturnLineId_fkey" FOREIGN KEY ("salesReturnLineId") REFERENCES "sales_return_line"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "sales_return_inspection" ADD CONSTRAINT "sales_return_inspection_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
