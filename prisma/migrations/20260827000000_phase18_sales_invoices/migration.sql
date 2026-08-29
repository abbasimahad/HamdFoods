CREATE TYPE "SalesInvoiceStatus" AS ENUM ('DRAFT', 'POSTED', 'CANCELLED');
CREATE TYPE "CustomerLedgerEntryType" AS ENUM ('SALES_INVOICE', 'CUSTOMER_PAYMENT', 'SALES_RETURN_CREDIT', 'CREDIT_NOTE', 'DEBIT_NOTE', 'OPENING_BALANCE', 'ADJUSTMENT');

CREATE TABLE "sales_invoice" (
  "id" TEXT NOT NULL,
  "number" TEXT NOT NULL,
  "salesOrderId" TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  "invoiceDate" DATE NOT NULL,
  "dueDate" DATE NOT NULL,
  "paymentTermsDays" INTEGER,
  "salespersonName" TEXT,
  "areaName" TEXT NOT NULL,
  "routeName" TEXT,
  "billingAddress" TEXT NOT NULL,
  "deliveryAddress" TEXT NOT NULL,
  "status" "SalesInvoiceStatus" NOT NULL DEFAULT 'DRAFT',
  "notes" TEXT,
  "subtotal" DECIMAL(24,6) NOT NULL,
  "discountTotal" DECIMAL(24,6) NOT NULL,
  "taxTotal" DECIMAL(24,6) NOT NULL,
  "grandTotal" DECIMAL(24,6) NOT NULL,
  "createdByUserId" TEXT NOT NULL,
  "postedByUserId" TEXT,
  "postedAt" TIMESTAMP(3),
  "cancelledByUserId" TEXT,
  "cancelledAt" TIMESTAMP(3),
  "cancellationReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "sales_invoice_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "sales_invoice_totals_nonnegative" CHECK ("subtotal" >= 0 AND "discountTotal" >= 0 AND "taxTotal" >= 0 AND "grandTotal" >= 0)
);

CREATE TABLE "sales_invoice_line" (
  "id" TEXT NOT NULL,
  "salesInvoiceId" TEXT NOT NULL,
  "salesOrderLineId" TEXT NOT NULL,
  "salesDispatchId" TEXT NOT NULL,
  "salesDispatchLineId" TEXT NOT NULL,
  "itemId" TEXT NOT NULL,
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
  CONSTRAINT "sales_invoice_line_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "sales_invoice_line_quantity" CHECK ("cartons" >= 0 AND "loosePieces" >= 0 AND "totalPieces" > 0),
  CONSTRAINT "sales_invoice_line_percentages" CHECK ("discount1Percent" >= 0 AND "discount2Percent" >= 0 AND "taxPercent" >= 0)
);

CREATE TABLE "sales_invoice_lot_allocation" (
  "id" TEXT NOT NULL,
  "salesInvoiceLineId" TEXT NOT NULL,
  "salesDispatchAllocationId" TEXT NOT NULL,
  "productionLotId" TEXT NOT NULL,
  "quantity" DECIMAL(24,6) NOT NULL,
  CONSTRAINT "sales_invoice_lot_allocation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "sales_invoice_lot_allocation_quantity" CHECK ("quantity" > 0)
);

CREATE TABLE "sales_invoice_sequence" (
  "year" INTEGER NOT NULL,
  "nextValue" INTEGER NOT NULL,
  CONSTRAINT "sales_invoice_sequence_pkey" PRIMARY KEY ("year")
);

CREATE TABLE "customer_ledger_entry" (
  "id" TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  "entryType" "CustomerLedgerEntryType" NOT NULL,
  "entryDate" DATE NOT NULL,
  "dueDate" DATE,
  "signedAmount" DECIMAL(24,6) NOT NULL,
  "salesInvoiceId" TEXT,
  "referenceType" TEXT NOT NULL,
  "referenceId" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "createdByUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "customer_ledger_entry_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "inventory_movement" ADD COLUMN "salesInvoiceId" TEXT;
ALTER TABLE "inventory_movement" ADD COLUMN "salesInvoiceLineId" TEXT;
ALTER TABLE "inventory_movement" ADD COLUMN "salesInvoiceAllocationId" TEXT;

CREATE UNIQUE INDEX "sales_invoice_number_key" ON "sales_invoice"("number");
CREATE INDEX "sales_invoice_salesOrderId_invoiceDate_idx" ON "sales_invoice"("salesOrderId", "invoiceDate");
CREATE INDEX "sales_invoice_customerId_invoiceDate_idx" ON "sales_invoice"("customerId", "invoiceDate");
CREATE INDEX "sales_invoice_status_invoiceDate_idx" ON "sales_invoice"("status", "invoiceDate");
CREATE INDEX "sales_invoice_line_salesOrderLineId_idx" ON "sales_invoice_line"("salesOrderLineId");
CREATE INDEX "sales_invoice_line_salesDispatchLineId_idx" ON "sales_invoice_line"("salesDispatchLineId");
CREATE INDEX "sales_invoice_line_itemId_idx" ON "sales_invoice_line"("itemId");
CREATE UNIQUE INDEX "sales_invoice_lot_allocation_salesInvoiceLineId_salesDispatchAllocationId_key" ON "sales_invoice_lot_allocation"("salesInvoiceLineId", "salesDispatchAllocationId");
CREATE INDEX "sales_invoice_lot_allocation_salesDispatchAllocationId_idx" ON "sales_invoice_lot_allocation"("salesDispatchAllocationId");
CREATE INDEX "sales_invoice_lot_allocation_productionLotId_idx" ON "sales_invoice_lot_allocation"("productionLotId");
CREATE UNIQUE INDEX "customer_ledger_entry_salesInvoiceId_key" ON "customer_ledger_entry"("salesInvoiceId");
CREATE INDEX "customer_ledger_entry_customerId_entryDate_idx" ON "customer_ledger_entry"("customerId", "entryDate");
CREATE INDEX "customer_ledger_entry_customerId_dueDate_idx" ON "customer_ledger_entry"("customerId", "dueDate");
CREATE INDEX "customer_ledger_entry_entryType_entryDate_idx" ON "customer_ledger_entry"("entryType", "entryDate");
CREATE INDEX "inventory_movement_salesInvoiceId_status_postedAt_idx" ON "inventory_movement"("salesInvoiceId", "status", "postedAt");
CREATE INDEX "inventory_movement_salesInvoiceLineId_idx" ON "inventory_movement"("salesInvoiceLineId");
CREATE INDEX "inventory_movement_salesInvoiceAllocationId_idx" ON "inventory_movement"("salesInvoiceAllocationId");

ALTER TABLE "sales_invoice" ADD CONSTRAINT "sales_invoice_salesOrderId_fkey" FOREIGN KEY ("salesOrderId") REFERENCES "sales_order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sales_invoice" ADD CONSTRAINT "sales_invoice_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sales_invoice" ADD CONSTRAINT "sales_invoice_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sales_invoice" ADD CONSTRAINT "sales_invoice_postedByUserId_fkey" FOREIGN KEY ("postedByUserId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sales_invoice" ADD CONSTRAINT "sales_invoice_cancelledByUserId_fkey" FOREIGN KEY ("cancelledByUserId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sales_invoice_line" ADD CONSTRAINT "sales_invoice_line_salesInvoiceId_fkey" FOREIGN KEY ("salesInvoiceId") REFERENCES "sales_invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "sales_invoice_line" ADD CONSTRAINT "sales_invoice_line_salesOrderLineId_fkey" FOREIGN KEY ("salesOrderLineId") REFERENCES "sales_order_line"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sales_invoice_line" ADD CONSTRAINT "sales_invoice_line_salesDispatchId_fkey" FOREIGN KEY ("salesDispatchId") REFERENCES "sales_dispatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sales_invoice_line" ADD CONSTRAINT "sales_invoice_line_salesDispatchLineId_fkey" FOREIGN KEY ("salesDispatchLineId") REFERENCES "sales_dispatch_line"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sales_invoice_line" ADD CONSTRAINT "sales_invoice_line_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sales_invoice_line" ADD CONSTRAINT "sales_invoice_line_canonicalUnitId_fkey" FOREIGN KEY ("canonicalUnitId") REFERENCES "unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sales_invoice_lot_allocation" ADD CONSTRAINT "sales_invoice_lot_allocation_salesInvoiceLineId_fkey" FOREIGN KEY ("salesInvoiceLineId") REFERENCES "sales_invoice_line"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "sales_invoice_lot_allocation" ADD CONSTRAINT "sales_invoice_lot_allocation_salesDispatchAllocationId_fkey" FOREIGN KEY ("salesDispatchAllocationId") REFERENCES "sales_dispatch_lot_allocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sales_invoice_lot_allocation" ADD CONSTRAINT "sales_invoice_lot_allocation_productionLotId_fkey" FOREIGN KEY ("productionLotId") REFERENCES "production_lot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "customer_ledger_entry" ADD CONSTRAINT "customer_ledger_entry_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "customer_ledger_entry" ADD CONSTRAINT "customer_ledger_entry_salesInvoiceId_fkey" FOREIGN KEY ("salesInvoiceId") REFERENCES "sales_invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "customer_ledger_entry" ADD CONSTRAINT "customer_ledger_entry_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "inventory_movement" ADD CONSTRAINT "inventory_movement_salesInvoiceId_fkey" FOREIGN KEY ("salesInvoiceId") REFERENCES "sales_invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "inventory_movement" ADD CONSTRAINT "inventory_movement_salesInvoiceLineId_fkey" FOREIGN KEY ("salesInvoiceLineId") REFERENCES "sales_invoice_line"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "inventory_movement" ADD CONSTRAINT "inventory_movement_salesInvoiceAllocationId_fkey" FOREIGN KEY ("salesInvoiceAllocationId") REFERENCES "sales_invoice_lot_allocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
