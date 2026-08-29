ALTER TYPE "InventoryMovementType" ADD VALUE IF NOT EXISTS 'SALES_RESERVATION';
ALTER TYPE "InventoryMovementType" ADD VALUE IF NOT EXISTS 'SALES_RESERVATION_RELEASE';

CREATE TYPE "SalesOrderStatus" AS ENUM ('DRAFT', 'APPROVED', 'PARTIALLY_DISPATCHED', 'DISPATCHED', 'CLOSED', 'CANCELLED');

CREATE TABLE "sales_order" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "orderDate" DATE NOT NULL,
    "customerId" TEXT NOT NULL,
    "salespersonId" TEXT,
    "salespersonName" TEXT,
    "areaId" TEXT NOT NULL,
    "areaName" TEXT NOT NULL,
    "routeId" TEXT,
    "routeName" TEXT,
    "warehouseId" TEXT NOT NULL,
    "status" "SalesOrderStatus" NOT NULL DEFAULT 'DRAFT',
    "customerReference" TEXT,
    "deliveryDate" DATE,
    "notes" TEXT,
    "paymentTermsDays" INTEGER,
    "customerCreditLimit" DECIMAL(24,6),
    "subtotal" DECIMAL(24,6) NOT NULL,
    "discountTotal" DECIMAL(24,6) NOT NULL,
    "taxTotal" DECIMAL(24,6) NOT NULL,
    "grandTotal" DECIMAL(24,6) NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "approvedByUserId" TEXT,
    "approvedAt" TIMESTAMP(3),
    "cancelledByUserId" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "cancellationReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "sales_order_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "sales_order_line" (
    "id" TEXT NOT NULL,
    "salesOrderId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "itemId" TEXT NOT NULL,
    "itemType" "ItemType" NOT NULL DEFAULT 'FINISHED_GOOD',
    "cartons" INTEGER NOT NULL,
    "loosePieces" INTEGER NOT NULL,
    "totalPieces" DECIMAL(24,6) NOT NULL,
    "canonicalUnitId" TEXT NOT NULL,
    "cartonRate" DECIMAL(24,6) NOT NULL,
    "pieceRate" DECIMAL(24,6) NOT NULL,
    "discount1Percent" DECIMAL(7,4) NOT NULL,
    "discount2Percent" DECIMAL(7,4) NOT NULL,
    "taxPercent" DECIMAL(7,4) NOT NULL,
    "grossAmount" DECIMAL(24,6) NOT NULL,
    "discountAmount" DECIMAL(24,6) NOT NULL,
    "taxAmount" DECIMAL(24,6) NOT NULL,
    "netAmount" DECIMAL(24,6) NOT NULL,
    "notes" TEXT,
    CONSTRAINT "sales_order_line_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "sales_order_line_quantity_nonnegative" CHECK ("cartons" >= 0 AND "loosePieces" >= 0 AND "totalPieces" > 0),
    CONSTRAINT "sales_order_line_rates_nonnegative" CHECK ("cartonRate" >= 0 AND "pieceRate" >= 0),
    CONSTRAINT "sales_order_line_percentages_valid" CHECK ("discount1Percent" >= 0 AND "discount1Percent" <= 100 AND "discount2Percent" >= 0 AND "discount2Percent" <= 100 AND "taxPercent" >= 0 AND "taxPercent" <= 100)
);

CREATE TABLE "sales_order_sequence" (
    "year" INTEGER NOT NULL,
    "nextValue" INTEGER NOT NULL,
    CONSTRAINT "sales_order_sequence_pkey" PRIMARY KEY ("year")
);

ALTER TABLE "inventory_movement" ADD COLUMN "salesOrderId" TEXT;
ALTER TABLE "inventory_movement" ADD COLUMN "salesOrderLineId" TEXT;

CREATE UNIQUE INDEX "sales_order_number_key" ON "sales_order"("number");
CREATE INDEX "sales_order_customerId_orderDate_idx" ON "sales_order"("customerId", "orderDate");
CREATE INDEX "sales_order_salespersonId_orderDate_idx" ON "sales_order"("salespersonId", "orderDate");
CREATE INDEX "sales_order_status_orderDate_idx" ON "sales_order"("status", "orderDate");
CREATE INDEX "sales_order_warehouseId_orderDate_idx" ON "sales_order"("warehouseId", "orderDate");
CREATE INDEX "sales_order_createdByUserId_idx" ON "sales_order"("createdByUserId");
CREATE UNIQUE INDEX "sales_order_line_salesOrderId_position_key" ON "sales_order_line"("salesOrderId", "position");
CREATE INDEX "sales_order_line_itemId_idx" ON "sales_order_line"("itemId");
CREATE INDEX "sales_order_line_canonicalUnitId_idx" ON "sales_order_line"("canonicalUnitId");
CREATE INDEX "inventory_movement_salesOrderId_status_postedAt_idx" ON "inventory_movement"("salesOrderId", "status", "postedAt");
CREATE INDEX "inventory_movement_salesOrderLineId_status_postedAt_idx" ON "inventory_movement"("salesOrderLineId", "status", "postedAt");

ALTER TABLE "sales_order" ADD CONSTRAINT "sales_order_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sales_order" ADD CONSTRAINT "sales_order_salespersonId_fkey" FOREIGN KEY ("salespersonId") REFERENCES "salesperson"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sales_order" ADD CONSTRAINT "sales_order_areaId_fkey" FOREIGN KEY ("areaId") REFERENCES "sales_area"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sales_order" ADD CONSTRAINT "sales_order_routeId_fkey" FOREIGN KEY ("routeId") REFERENCES "sales_route"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sales_order" ADD CONSTRAINT "sales_order_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sales_order" ADD CONSTRAINT "sales_order_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sales_order" ADD CONSTRAINT "sales_order_approvedByUserId_fkey" FOREIGN KEY ("approvedByUserId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sales_order" ADD CONSTRAINT "sales_order_cancelledByUserId_fkey" FOREIGN KEY ("cancelledByUserId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sales_order_line" ADD CONSTRAINT "sales_order_line_salesOrderId_fkey" FOREIGN KEY ("salesOrderId") REFERENCES "sales_order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "sales_order_line" ADD CONSTRAINT "sales_order_line_itemId_itemType_fkey" FOREIGN KEY ("itemId", "itemType") REFERENCES "item"("id", "itemType") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sales_order_line" ADD CONSTRAINT "sales_order_line_canonicalUnitId_fkey" FOREIGN KEY ("canonicalUnitId") REFERENCES "unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "inventory_movement" ADD CONSTRAINT "inventory_movement_salesOrderId_fkey" FOREIGN KEY ("salesOrderId") REFERENCES "sales_order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "inventory_movement" ADD CONSTRAINT "inventory_movement_salesOrderLineId_fkey" FOREIGN KEY ("salesOrderLineId") REFERENCES "sales_order_line"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
