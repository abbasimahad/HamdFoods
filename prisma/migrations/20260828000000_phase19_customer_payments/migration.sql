CREATE TYPE "CustomerPaymentStatus" AS ENUM ('DRAFT', 'POSTED', 'CANCELLED');
CREATE TYPE "CustomerPaymentMethod" AS ENUM ('CASH', 'BANK_TRANSFER', 'CHEQUE', 'CARD', 'OTHER');

CREATE TABLE "customer_payment" (
  "id" TEXT NOT NULL,
  "number" TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  "paymentDate" DATE NOT NULL,
  "method" "CustomerPaymentMethod" NOT NULL,
  "totalAmount" DECIMAL(24,6) NOT NULL,
  "referenceNumber" TEXT,
  "bankName" TEXT,
  "chequeNumber" TEXT,
  "chequeDate" DATE,
  "notes" TEXT,
  "status" "CustomerPaymentStatus" NOT NULL DEFAULT 'DRAFT',
  "createdByUserId" TEXT NOT NULL,
  "postedByUserId" TEXT,
  "postedAt" TIMESTAMP(3),
  "cancelledByUserId" TEXT,
  "cancelledAt" TIMESTAMP(3),
  "cancellationReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "customer_payment_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "customer_payment_total_positive" CHECK ("totalAmount" > 0)
);

CREATE TABLE "customer_payment_allocation" (
  "id" TEXT NOT NULL,
  "customerPaymentId" TEXT NOT NULL,
  "salesInvoiceId" TEXT NOT NULL,
  "allocatedAmount" DECIMAL(24,6) NOT NULL,
  "createdByUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "customer_payment_allocation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "customer_payment_allocation_amount_positive" CHECK ("allocatedAmount" > 0)
);

CREATE TABLE "customer_payment_sequence" (
  "year" INTEGER NOT NULL,
  "nextValue" INTEGER NOT NULL,
  CONSTRAINT "customer_payment_sequence_pkey" PRIMARY KEY ("year")
);

ALTER TABLE "customer_ledger_entry" ADD COLUMN "customerPaymentId" TEXT;

CREATE UNIQUE INDEX "customer_payment_number_key" ON "customer_payment"("number");
CREATE INDEX "customer_payment_customerId_paymentDate_idx" ON "customer_payment"("customerId", "paymentDate");
CREATE INDEX "customer_payment_status_paymentDate_idx" ON "customer_payment"("status", "paymentDate");
CREATE INDEX "customer_payment_allocation_customerPaymentId_salesInvoiceId_idx" ON "customer_payment_allocation"("customerPaymentId", "salesInvoiceId");
CREATE INDEX "customer_payment_allocation_salesInvoiceId_idx" ON "customer_payment_allocation"("salesInvoiceId");
CREATE UNIQUE INDEX "customer_ledger_entry_customerPaymentId_key" ON "customer_ledger_entry"("customerPaymentId");

ALTER TABLE "customer_payment" ADD CONSTRAINT "customer_payment_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "customer_payment" ADD CONSTRAINT "customer_payment_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "customer_payment" ADD CONSTRAINT "customer_payment_postedByUserId_fkey" FOREIGN KEY ("postedByUserId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "customer_payment" ADD CONSTRAINT "customer_payment_cancelledByUserId_fkey" FOREIGN KEY ("cancelledByUserId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "customer_payment_allocation" ADD CONSTRAINT "customer_payment_allocation_customerPaymentId_fkey" FOREIGN KEY ("customerPaymentId") REFERENCES "customer_payment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "customer_payment_allocation" ADD CONSTRAINT "customer_payment_allocation_salesInvoiceId_fkey" FOREIGN KEY ("salesInvoiceId") REFERENCES "sales_invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "customer_payment_allocation" ADD CONSTRAINT "customer_payment_allocation_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "customer_ledger_entry" ADD CONSTRAINT "customer_ledger_entry_customerPaymentId_fkey" FOREIGN KEY ("customerPaymentId") REFERENCES "customer_payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
