-- Purchase Invoices: PO->GRN->Invoice matching/true-up authority.
-- Scoped strictly to the new Purchase Invoice aggregate. No existing table,
-- column, constraint, or index is altered, renamed, or dropped by this
-- migration; GRN posting, GRN QC accounting, GRNI behavior, FINAL inventory
-- valuation, and existing AP authority are untouched.

-- CreateEnum
CREATE TYPE "PurchaseInvoiceStatus" AS ENUM ('DRAFT', 'POSTED', 'CANCELLED', 'REVERSED');

-- AlterEnum
ALTER TYPE "AccountingMappingKey" ADD VALUE 'PURCHASE_PRICE_VARIANCE';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AccountingSourceType" ADD VALUE 'PURCHASE_INVOICE_VARIANCE';
ALTER TYPE "AccountingSourceType" ADD VALUE 'PURCHASE_INVOICE_REVERSAL';

-- AlterEnum
ALTER TYPE "AuditEntityType" ADD VALUE 'PURCHASE_INVOICE';

-- AlterEnum
ALTER TYPE "SupplierLedgerEntryType" ADD VALUE 'PURCHASE_INVOICE_VARIANCE';

-- CreateTable
CREATE TABLE "purchase_invoice" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "supplierInvoiceNumber" TEXT NOT NULL,
    "invoiceDate" DATE NOT NULL,
    "dueDate" DATE,
    "status" "PurchaseInvoiceStatus" NOT NULL DEFAULT 'DRAFT',
    "notes" TEXT,
    "subtotal" DECIMAL(24,6) NOT NULL,
    "taxTotal" DECIMAL(24,6) NOT NULL,
    "grandTotal" DECIMAL(24,6) NOT NULL,
    "priceVarianceTotal" DECIMAL(24,6) NOT NULL DEFAULT 0,
    "taxVarianceTotal" DECIMAL(24,6) NOT NULL DEFAULT 0,
    "createdByUserId" TEXT NOT NULL,
    "postedByUserId" TEXT,
    "postedAt" TIMESTAMP(3),
    "cancelledByUserId" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "cancellationReason" TEXT,
    "reversedByUserId" TEXT,
    "reversedAt" TIMESTAMP(3),
    "reversalReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "purchase_invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_invoice_line" (
    "id" TEXT NOT NULL,
    "purchaseInvoiceId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "purchaseOrderLineId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "invoicedQuantity" DECIMAL(24,6) NOT NULL,
    "invoicedUnitRate" DECIMAL(24,6) NOT NULL,
    "taxPercent" DECIMAL(7,4) NOT NULL,
    "grossAmount" DECIMAL(24,6) NOT NULL,
    "taxAmount" DECIMAL(24,6) NOT NULL,
    "netAmount" DECIMAL(24,6) NOT NULL,
    "notes" TEXT,

    CONSTRAINT "purchase_invoice_line_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_invoice_line_match" (
    "id" TEXT NOT NULL,
    "purchaseInvoiceLineId" TEXT NOT NULL,
    "goodsReceiptLineId" TEXT NOT NULL,
    "matchedQuantity" DECIMAL(24,6) NOT NULL,
    "grnDerivedUnitCost" DECIMAL(30,12) NOT NULL DEFAULT 0,
    "grnDerivedTaxAmount" DECIMAL(24,6) NOT NULL DEFAULT 0,
    "priceVarianceAmount" DECIMAL(24,6) NOT NULL DEFAULT 0,
    "taxVarianceAmount" DECIMAL(24,6) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "purchase_invoice_line_match_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_invoice_sequence" (
    "year" INTEGER NOT NULL,
    "nextValue" INTEGER NOT NULL,

    CONSTRAINT "purchase_invoice_sequence_pkey" PRIMARY KEY ("year")
);

-- CreateIndex
CREATE UNIQUE INDEX "purchase_invoice_number_key" ON "purchase_invoice"("number");

-- CreateIndex
CREATE INDEX "purchase_invoice_status_invoiceDate_idx" ON "purchase_invoice"("status", "invoiceDate");

-- CreateIndex
CREATE INDEX "purchase_invoice_supplierId_invoiceDate_idx" ON "purchase_invoice"("supplierId", "invoiceDate");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_invoice_supplier_number_uidx" ON "purchase_invoice"("supplierId", "supplierInvoiceNumber");

-- CreateIndex
CREATE INDEX "purchase_invoice_line_purchaseOrderLineId_idx" ON "purchase_invoice_line"("purchaseOrderLineId");

-- CreateIndex
CREATE INDEX "purchase_invoice_line_itemId_idx" ON "purchase_invoice_line"("itemId");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_invoice_line_purchaseInvoiceId_position_key" ON "purchase_invoice_line"("purchaseInvoiceId", "position");

-- CreateIndex
CREATE INDEX "purchase_invoice_line_match_goodsReceiptLineId_idx" ON "purchase_invoice_line_match"("goodsReceiptLineId");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_invoice_line_match_uidx" ON "purchase_invoice_line_match"("purchaseInvoiceLineId", "goodsReceiptLineId");

-- AddForeignKey
ALTER TABLE "purchase_invoice" ADD CONSTRAINT "purchase_invoice_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_invoice" ADD CONSTRAINT "purchase_invoice_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_invoice" ADD CONSTRAINT "purchase_invoice_postedByUserId_fkey" FOREIGN KEY ("postedByUserId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_invoice" ADD CONSTRAINT "purchase_invoice_cancelledByUserId_fkey" FOREIGN KEY ("cancelledByUserId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_invoice" ADD CONSTRAINT "purchase_invoice_reversedByUserId_fkey" FOREIGN KEY ("reversedByUserId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_invoice_line" ADD CONSTRAINT "purchase_invoice_line_purchaseInvoiceId_fkey" FOREIGN KEY ("purchaseInvoiceId") REFERENCES "purchase_invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_invoice_line" ADD CONSTRAINT "purchase_invoice_line_purchaseOrderLineId_fkey" FOREIGN KEY ("purchaseOrderLineId") REFERENCES "purchase_order_line"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_invoice_line" ADD CONSTRAINT "purchase_invoice_line_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_invoice_line_match" ADD CONSTRAINT "purchase_invoice_line_match_purchaseInvoiceLineId_fkey" FOREIGN KEY ("purchaseInvoiceLineId") REFERENCES "purchase_invoice_line"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_invoice_line_match" ADD CONSTRAINT "purchase_invoice_line_match_goodsReceiptLineId_fkey" FOREIGN KEY ("goodsReceiptLineId") REFERENCES "goods_receipt_line"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Guard: header content is immutable once not DRAFT; only approved status
-- transitions are allowed (mirrors enforce_goods_receipt_lifecycle()).
CREATE FUNCTION enforce_purchase_invoice_lifecycle() RETURNS trigger AS $$
BEGIN
  IF OLD."status" <> 'DRAFT' AND (
    NEW."supplierId" IS DISTINCT FROM OLD."supplierId"
    OR NEW."supplierInvoiceNumber" IS DISTINCT FROM OLD."supplierInvoiceNumber"
    OR NEW."invoiceDate" IS DISTINCT FROM OLD."invoiceDate"
    OR NEW."dueDate" IS DISTINCT FROM OLD."dueDate"
    OR NEW."notes" IS DISTINCT FROM OLD."notes"
    OR NEW."subtotal" IS DISTINCT FROM OLD."subtotal"
    OR NEW."taxTotal" IS DISTINCT FROM OLD."taxTotal"
    OR NEW."grandTotal" IS DISTINCT FROM OLD."grandTotal"
  ) THEN
    RAISE EXCEPTION 'Posted purchase invoice details are immutable';
  END IF;

  IF (OLD."status" = 'DRAFT' AND NEW."status" NOT IN ('DRAFT', 'POSTED', 'CANCELLED'))
    OR (OLD."status" = 'POSTED' AND NEW."status" NOT IN ('POSTED', 'REVERSED'))
    OR (OLD."status" IN ('CANCELLED', 'REVERSED') AND NEW."status" <> OLD."status")
  THEN
    RAISE EXCEPTION 'Invalid purchase invoice status transition';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER purchase_invoice_lifecycle_guard
BEFORE UPDATE ON "purchase_invoice"
FOR EACH ROW EXECUTE FUNCTION enforce_purchase_invoice_lifecycle();

-- Guard: invoice lines are mutable only while the parent invoice is DRAFT
-- (mirrors enforce_purchase_return_line_mutation()). Freezing of matched
-- quantities/prices happens on POST while the header is still DRAFT, just
-- before the header status flips to POSTED in the same transaction.
CREATE FUNCTION enforce_purchase_invoice_line_mutation() RETURNS trigger AS $$
DECLARE parent_status "PurchaseInvoiceStatus";
BEGIN
  SELECT "status" INTO parent_status FROM "purchase_invoice" WHERE "id" = COALESCE(OLD."purchaseInvoiceId", NEW."purchaseInvoiceId");
  IF parent_status <> 'DRAFT' THEN RAISE EXCEPTION 'Posted purchase invoice lines are immutable'; END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER purchase_invoice_line_mutation_guard BEFORE UPDATE OR DELETE ON "purchase_invoice_line"
FOR EACH ROW EXECUTE FUNCTION enforce_purchase_invoice_line_mutation();

-- Guard: GRN matches (including the frozen variance snapshot columns) are
-- mutable only while the parent invoice is DRAFT.
CREATE FUNCTION enforce_purchase_invoice_match_mutation() RETURNS trigger AS $$
DECLARE parent_status "PurchaseInvoiceStatus";
BEGIN
  SELECT pi."status" INTO parent_status
  FROM "purchase_invoice_line" pil
  JOIN "purchase_invoice" pi ON pi."id" = pil."purchaseInvoiceId"
  WHERE pil."id" = COALESCE(OLD."purchaseInvoiceLineId", NEW."purchaseInvoiceLineId");
  IF parent_status <> 'DRAFT' THEN RAISE EXCEPTION 'Posted purchase invoice matches are immutable'; END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER purchase_invoice_match_mutation_guard BEFORE UPDATE OR DELETE ON "purchase_invoice_line_match"
FOR EACH ROW EXECUTE FUNCTION enforce_purchase_invoice_match_mutation();

-- Guard: a GRN match must belong to the same purchase-order line as its
-- invoice line -- an invoice line cannot be matched to a GRN line that
-- fulfilled a different PO line.
CREATE FUNCTION enforce_purchase_invoice_match_identity() RETURNS trigger AS $$
DECLARE line_po_line_id TEXT;
DECLARE grn_po_line_id TEXT;
BEGIN
  SELECT "purchaseOrderLineId" INTO line_po_line_id FROM "purchase_invoice_line" WHERE "id" = NEW."purchaseInvoiceLineId";
  SELECT "purchaseOrderLineId" INTO grn_po_line_id FROM "goods_receipt_line" WHERE "id" = NEW."goodsReceiptLineId";
  IF line_po_line_id IS DISTINCT FROM grn_po_line_id THEN
    RAISE EXCEPTION 'Matched goods receipt line does not belong to the invoice line''s purchase order line';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER purchase_invoice_match_identity_guard BEFORE INSERT OR UPDATE ON "purchase_invoice_line_match"
FOR EACH ROW EXECUTE FUNCTION enforce_purchase_invoice_match_identity();
