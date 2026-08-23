CREATE TYPE "PurchaseOrderStatus" AS ENUM ('DRAFT', 'APPROVED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CLOSED', 'CANCELLED');

CREATE TABLE "supplier" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "contactPerson" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "secondaryPhone" TEXT,
    "email" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "taxRegistrationNo" TEXT,
    "paymentTermsDays" INTEGER,
    "notes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "supplier_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "supplier_payment_terms_check" CHECK ("paymentTermsDays" IS NULL OR "paymentTermsDays" >= 0)
);

CREATE TABLE "purchase_order" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "orderDate" DATE NOT NULL,
    "expectedDeliveryDate" DATE,
    "status" "PurchaseOrderStatus" NOT NULL DEFAULT 'DRAFT',
    "supplierReference" TEXT,
    "notes" TEXT,
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
    CONSTRAINT "purchase_order_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "purchase_order_totals_check" CHECK (
      "subtotal" >= 0 AND "discountTotal" >= 0 AND "taxTotal" >= 0 AND "grandTotal" >= 0
    ),
    CONSTRAINT "purchase_order_delivery_date_check" CHECK (
      "expectedDeliveryDate" IS NULL OR "expectedDeliveryDate" >= "orderDate"
    ),
    CONSTRAINT "purchase_order_approval_pair_check" CHECK (
      ("approvedByUserId" IS NULL) = ("approvedAt" IS NULL)
    ),
    CONSTRAINT "purchase_order_cancellation_pair_check" CHECK (
      ("cancelledByUserId" IS NULL) = ("cancelledAt" IS NULL)
    ),
    CONSTRAINT "purchase_order_status_metadata_check" CHECK (
      ("status" = 'DRAFT' AND "approvedAt" IS NULL AND "cancelledAt" IS NULL AND "cancellationReason" IS NULL)
      OR ("status" IN ('APPROVED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CLOSED') AND "approvedAt" IS NOT NULL AND "cancelledAt" IS NULL AND "cancellationReason" IS NULL)
      OR ("status" = 'CANCELLED' AND "cancelledAt" IS NOT NULL AND length(btrim("cancellationReason")) > 0)
    )
);

CREATE TABLE "purchase_order_line" (
    "id" TEXT NOT NULL,
    "purchaseOrderId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "itemId" TEXT NOT NULL,
    "itemType" "ItemType" NOT NULL,
    "orderedQuantity" DECIMAL(24,6) NOT NULL,
    "orderUnitId" TEXT NOT NULL,
    "normalizedQuantity" DECIMAL(24,6) NOT NULL,
    "canonicalUnitId" TEXT NOT NULL,
    "unitRate" DECIMAL(24,6) NOT NULL,
    "discountPercent" DECIMAL(7,4) NOT NULL,
    "taxPercent" DECIMAL(7,4) NOT NULL,
    "grossAmount" DECIMAL(24,6) NOT NULL,
    "discountAmount" DECIMAL(24,6) NOT NULL,
    "taxAmount" DECIMAL(24,6) NOT NULL,
    "netAmount" DECIMAL(24,6) NOT NULL,
    "notes" TEXT,
    CONSTRAINT "purchase_order_line_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "purchase_order_line_position_check" CHECK ("position" > 0),
    CONSTRAINT "purchase_order_line_item_type_check" CHECK ("itemType" IN ('RAW_MATERIAL', 'PACKAGING_MATERIAL')),
    CONSTRAINT "purchase_order_line_quantity_check" CHECK ("orderedQuantity" > 0 AND "normalizedQuantity" > 0),
    CONSTRAINT "purchase_order_line_rate_check" CHECK ("unitRate" >= 0),
    CONSTRAINT "purchase_order_line_percentage_check" CHECK (
      "discountPercent" >= 0 AND "discountPercent" <= 100 AND "taxPercent" >= 0 AND "taxPercent" <= 100
    ),
    CONSTRAINT "purchase_order_line_amounts_check" CHECK (
      "grossAmount" >= 0 AND "discountAmount" >= 0 AND "taxAmount" >= 0 AND "netAmount" >= 0
    )
);

CREATE TABLE "purchase_order_sequence" (
    "year" INTEGER NOT NULL,
    "nextValue" INTEGER NOT NULL,
    CONSTRAINT "purchase_order_sequence_pkey" PRIMARY KEY ("year"),
    CONSTRAINT "purchase_order_sequence_positive_check" CHECK ("nextValue" > 0)
);

CREATE UNIQUE INDEX "supplier_code_key" ON "supplier"("code");
CREATE INDEX "supplier_active_name_idx" ON "supplier"("active", "name");
CREATE INDEX "supplier_city_active_idx" ON "supplier"("city", "active");
CREATE UNIQUE INDEX "purchase_order_number_key" ON "purchase_order"("number");
CREATE INDEX "purchase_order_status_orderDate_idx" ON "purchase_order"("status", "orderDate");
CREATE INDEX "purchase_order_supplierId_orderDate_idx" ON "purchase_order"("supplierId", "orderDate");
CREATE INDEX "purchase_order_createdByUserId_idx" ON "purchase_order"("createdByUserId");
CREATE INDEX "purchase_order_approvedByUserId_idx" ON "purchase_order"("approvedByUserId");
CREATE INDEX "purchase_order_cancelledByUserId_idx" ON "purchase_order"("cancelledByUserId");
CREATE INDEX "purchase_order_line_itemId_idx" ON "purchase_order_line"("itemId");
CREATE INDEX "purchase_order_line_orderUnitId_idx" ON "purchase_order_line"("orderUnitId");
CREATE INDEX "purchase_order_line_canonicalUnitId_idx" ON "purchase_order_line"("canonicalUnitId");
CREATE UNIQUE INDEX "purchase_order_line_purchaseOrderId_position_key" ON "purchase_order_line"("purchaseOrderId", "position");

ALTER TABLE "purchase_order" ADD CONSTRAINT "purchase_order_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "purchase_order" ADD CONSTRAINT "purchase_order_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "purchase_order" ADD CONSTRAINT "purchase_order_approvedByUserId_fkey" FOREIGN KEY ("approvedByUserId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "purchase_order" ADD CONSTRAINT "purchase_order_cancelledByUserId_fkey" FOREIGN KEY ("cancelledByUserId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "purchase_order_line" ADD CONSTRAINT "purchase_order_line_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "purchase_order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "purchase_order_line" ADD CONSTRAINT "purchase_order_line_itemId_itemType_fkey" FOREIGN KEY ("itemId", "itemType") REFERENCES "item"("id", "itemType") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "purchase_order_line" ADD CONSTRAINT "purchase_order_line_orderUnitId_fkey" FOREIGN KEY ("orderUnitId") REFERENCES "unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "purchase_order_line" ADD CONSTRAINT "purchase_order_line_canonicalUnitId_fkey" FOREIGN KEY ("canonicalUnitId") REFERENCES "unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
