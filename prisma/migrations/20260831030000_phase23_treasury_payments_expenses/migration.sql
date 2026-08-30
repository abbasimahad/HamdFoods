ALTER TYPE "AccountingSourceType" ADD VALUE 'SUPPLIER_PAYMENT';
ALTER TYPE "AccountingSourceType" ADD VALUE 'EXPENSE_VOUCHER';
ALTER TYPE "AccountingSourceType" ADD VALUE 'EXPENSE_REVERSAL';
ALTER TYPE "AccountingSourceType" ADD VALUE 'TREASURY_TRANSFER';
CREATE TYPE "TreasuryAccountType" AS ENUM ('CASH', 'BANK', 'PETTY_CASH', 'CLEARING');
CREATE TYPE "SupplierPaymentStatus" AS ENUM ('DRAFT', 'POSTED', 'CANCELLED');
CREATE TYPE "SupplierPaymentMethod" AS ENUM ('CASH', 'BANK_TRANSFER', 'CHEQUE', 'CARD', 'OTHER');
CREATE TYPE "ExpenseVoucherStatus" AS ENUM ('DRAFT', 'POSTED', 'CANCELLED');
CREATE TYPE "TreasuryTransferStatus" AS ENUM ('DRAFT', 'POSTED', 'CANCELLED');

CREATE TABLE "treasury_account" (
  "id" TEXT NOT NULL, "code" TEXT NOT NULL, "name" TEXT NOT NULL, "accountType" "TreasuryAccountType" NOT NULL,
  "glAccountId" TEXT NOT NULL, "bankName" TEXT, "accountTitle" TEXT, "accountNumberMasked" TEXT, "branch" TEXT,
  "notes" TEXT, "active" BOOLEAN NOT NULL DEFAULT true, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "treasury_account_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "supplier_payment" (
  "id" TEXT NOT NULL, "number" TEXT NOT NULL, "supplierId" TEXT NOT NULL, "paymentDate" DATE NOT NULL,
  "treasuryAccountId" TEXT NOT NULL, "method" "SupplierPaymentMethod" NOT NULL, "totalAmount" DECIMAL(30,6) NOT NULL,
  "referenceNumber" TEXT, "bankReference" TEXT, "chequeNumber" TEXT, "chequeDate" DATE, "notes" TEXT,
  "status" "SupplierPaymentStatus" NOT NULL DEFAULT 'DRAFT', "createdByUserId" TEXT NOT NULL, "postedByUserId" TEXT,
  "postedAt" TIMESTAMP(3), "cancelledByUserId" TEXT, "cancelledAt" TIMESTAMP(3), "cancellationReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "supplier_payment_pkey" PRIMARY KEY ("id"), CONSTRAINT "supplier_payment_amount_check" CHECK ("totalAmount" > 0)
);
CREATE TABLE "supplier_payment_allocation" (
  "id" TEXT NOT NULL, "supplierPaymentId" TEXT NOT NULL, "payableLedgerEntryId" TEXT NOT NULL,
  "allocatedAmount" DECIMAL(30,6) NOT NULL, "createdByUserId" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "supplier_payment_allocation_pkey" PRIMARY KEY ("id"), CONSTRAINT "supplier_payment_allocation_amount_check" CHECK ("allocatedAmount" > 0)
);
CREATE TABLE "supplier_payment_sequence" ("year" INTEGER NOT NULL, "nextValue" INTEGER NOT NULL, CONSTRAINT "supplier_payment_sequence_pkey" PRIMARY KEY ("year"));
CREATE TABLE "expense_voucher" (
  "id" TEXT NOT NULL, "number" TEXT NOT NULL, "expenseDate" DATE NOT NULL, "payee" TEXT, "supplierId" TEXT,
  "treasuryAccountId" TEXT NOT NULL, "description" TEXT NOT NULL, "totalAmount" DECIMAL(30,6) NOT NULL,
  "referenceNumber" TEXT, "notes" TEXT, "status" "ExpenseVoucherStatus" NOT NULL DEFAULT 'DRAFT', "reversalOfId" TEXT,
  "createdByUserId" TEXT NOT NULL, "postedByUserId" TEXT, "postedAt" TIMESTAMP(3), "cancelledByUserId" TEXT,
  "cancelledAt" TIMESTAMP(3), "cancellationReason" TEXT, "reversedByUserId" TEXT, "reversedAt" TIMESTAMP(3),
  "reversalReason" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "expense_voucher_pkey" PRIMARY KEY ("id"), CONSTRAINT "expense_voucher_total_check" CHECK ("totalAmount" > 0)
);
CREATE TABLE "expense_voucher_line" (
  "id" TEXT NOT NULL, "expenseVoucherId" TEXT NOT NULL, "position" INTEGER NOT NULL, "expenseAccountId" TEXT NOT NULL,
  "description" TEXT NOT NULL, "amount" DECIMAL(30,6) NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "expense_voucher_line_pkey" PRIMARY KEY ("id"), CONSTRAINT "expense_voucher_line_amount_check" CHECK ("amount" > 0)
);
CREATE TABLE "expense_voucher_sequence" ("year" INTEGER NOT NULL, "nextValue" INTEGER NOT NULL, CONSTRAINT "expense_voucher_sequence_pkey" PRIMARY KEY ("year"));
CREATE TABLE "treasury_transfer" (
  "id" TEXT NOT NULL, "number" TEXT NOT NULL, "transferDate" DATE NOT NULL, "sourceTreasuryAccountId" TEXT NOT NULL,
  "destinationTreasuryAccountId" TEXT NOT NULL, "amount" DECIMAL(30,6) NOT NULL, "referenceNumber" TEXT, "notes" TEXT,
  "status" "TreasuryTransferStatus" NOT NULL DEFAULT 'DRAFT', "createdByUserId" TEXT NOT NULL, "postedByUserId" TEXT,
  "postedAt" TIMESTAMP(3), "cancelledByUserId" TEXT, "cancelledAt" TIMESTAMP(3), "cancellationReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "treasury_transfer_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "treasury_transfer_amount_check" CHECK ("amount" > 0),
  CONSTRAINT "treasury_transfer_distinct_accounts_check" CHECK ("sourceTreasuryAccountId" <> "destinationTreasuryAccountId")
);
CREATE TABLE "treasury_transfer_sequence" ("year" INTEGER NOT NULL, "nextValue" INTEGER NOT NULL, CONSTRAINT "treasury_transfer_sequence_pkey" PRIMARY KEY ("year"));

CREATE UNIQUE INDEX "treasury_account_code_key" ON "treasury_account"("code");
CREATE INDEX "treasury_account_active_type_code_idx" ON "treasury_account"("active", "accountType", "code");
CREATE INDEX "treasury_account_glAccountId_idx" ON "treasury_account"("glAccountId");
CREATE UNIQUE INDEX "supplier_payment_number_key" ON "supplier_payment"("number");
CREATE INDEX "supplier_payment_supplier_date_idx" ON "supplier_payment"("supplierId", "paymentDate");
CREATE INDEX "supplier_payment_treasury_date_idx" ON "supplier_payment"("treasuryAccountId", "paymentDate");
CREATE INDEX "supplier_payment_status_date_idx" ON "supplier_payment"("status", "paymentDate");
CREATE INDEX "supplier_payment_allocation_payment_ledger_idx" ON "supplier_payment_allocation"("supplierPaymentId", "payableLedgerEntryId");
CREATE INDEX "supplier_payment_allocation_ledger_idx" ON "supplier_payment_allocation"("payableLedgerEntryId");
CREATE UNIQUE INDEX "expense_voucher_number_key" ON "expense_voucher"("number");
CREATE UNIQUE INDEX "expense_voucher_reversalOfId_key" ON "expense_voucher"("reversalOfId");
CREATE INDEX "expense_voucher_date_status_idx" ON "expense_voucher"("expenseDate", "status");
CREATE INDEX "expense_voucher_treasury_date_idx" ON "expense_voucher"("treasuryAccountId", "expenseDate");
CREATE INDEX "expense_voucher_supplier_date_idx" ON "expense_voucher"("supplierId", "expenseDate");
CREATE UNIQUE INDEX "expense_voucher_line_voucher_position_key" ON "expense_voucher_line"("expenseVoucherId", "position");
CREATE INDEX "expense_voucher_line_account_idx" ON "expense_voucher_line"("expenseAccountId");
CREATE UNIQUE INDEX "treasury_transfer_number_key" ON "treasury_transfer"("number");
CREATE INDEX "treasury_transfer_date_status_idx" ON "treasury_transfer"("transferDate", "status");
CREATE INDEX "treasury_transfer_source_date_idx" ON "treasury_transfer"("sourceTreasuryAccountId", "transferDate");
CREATE INDEX "treasury_transfer_destination_date_idx" ON "treasury_transfer"("destinationTreasuryAccountId", "transferDate");

ALTER TABLE "treasury_account" ADD CONSTRAINT "treasury_account_gl_fkey" FOREIGN KEY ("glAccountId") REFERENCES "accounting_account"("id") ON DELETE RESTRICT;
ALTER TABLE "supplier_payment" ADD CONSTRAINT "supplier_payment_supplier_fkey" FOREIGN KEY ("supplierId") REFERENCES "supplier"("id") ON DELETE RESTRICT;
ALTER TABLE "supplier_payment" ADD CONSTRAINT "supplier_payment_treasury_fkey" FOREIGN KEY ("treasuryAccountId") REFERENCES "treasury_account"("id") ON DELETE RESTRICT;
ALTER TABLE "supplier_payment" ADD CONSTRAINT "supplier_payment_created_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "user"("id") ON DELETE RESTRICT;
ALTER TABLE "supplier_payment" ADD CONSTRAINT "supplier_payment_posted_fkey" FOREIGN KEY ("postedByUserId") REFERENCES "user"("id") ON DELETE RESTRICT;
ALTER TABLE "supplier_payment" ADD CONSTRAINT "supplier_payment_cancelled_fkey" FOREIGN KEY ("cancelledByUserId") REFERENCES "user"("id") ON DELETE RESTRICT;
ALTER TABLE "supplier_payment_allocation" ADD CONSTRAINT "supplier_payment_allocation_payment_fkey" FOREIGN KEY ("supplierPaymentId") REFERENCES "supplier_payment"("id") ON DELETE CASCADE;
ALTER TABLE "supplier_payment_allocation" ADD CONSTRAINT "supplier_payment_allocation_ledger_fkey" FOREIGN KEY ("payableLedgerEntryId") REFERENCES "supplier_payable_ledger_entry"("id") ON DELETE RESTRICT;
ALTER TABLE "supplier_payment_allocation" ADD CONSTRAINT "supplier_payment_allocation_created_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "user"("id") ON DELETE RESTRICT;
ALTER TABLE "expense_voucher" ADD CONSTRAINT "expense_voucher_supplier_fkey" FOREIGN KEY ("supplierId") REFERENCES "supplier"("id") ON DELETE RESTRICT;
ALTER TABLE "expense_voucher" ADD CONSTRAINT "expense_voucher_treasury_fkey" FOREIGN KEY ("treasuryAccountId") REFERENCES "treasury_account"("id") ON DELETE RESTRICT;
ALTER TABLE "expense_voucher" ADD CONSTRAINT "expense_voucher_reversal_fkey" FOREIGN KEY ("reversalOfId") REFERENCES "expense_voucher"("id") ON DELETE RESTRICT;
ALTER TABLE "expense_voucher" ADD CONSTRAINT "expense_voucher_created_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "user"("id") ON DELETE RESTRICT;
ALTER TABLE "expense_voucher" ADD CONSTRAINT "expense_voucher_posted_fkey" FOREIGN KEY ("postedByUserId") REFERENCES "user"("id") ON DELETE RESTRICT;
ALTER TABLE "expense_voucher" ADD CONSTRAINT "expense_voucher_cancelled_fkey" FOREIGN KEY ("cancelledByUserId") REFERENCES "user"("id") ON DELETE RESTRICT;
ALTER TABLE "expense_voucher" ADD CONSTRAINT "expense_voucher_reversed_fkey" FOREIGN KEY ("reversedByUserId") REFERENCES "user"("id") ON DELETE RESTRICT;
ALTER TABLE "expense_voucher_line" ADD CONSTRAINT "expense_voucher_line_voucher_fkey" FOREIGN KEY ("expenseVoucherId") REFERENCES "expense_voucher"("id") ON DELETE CASCADE;
ALTER TABLE "expense_voucher_line" ADD CONSTRAINT "expense_voucher_line_account_fkey" FOREIGN KEY ("expenseAccountId") REFERENCES "accounting_account"("id") ON DELETE RESTRICT;
ALTER TABLE "treasury_transfer" ADD CONSTRAINT "treasury_transfer_source_fkey" FOREIGN KEY ("sourceTreasuryAccountId") REFERENCES "treasury_account"("id") ON DELETE RESTRICT;
ALTER TABLE "treasury_transfer" ADD CONSTRAINT "treasury_transfer_destination_fkey" FOREIGN KEY ("destinationTreasuryAccountId") REFERENCES "treasury_account"("id") ON DELETE RESTRICT;
ALTER TABLE "treasury_transfer" ADD CONSTRAINT "treasury_transfer_created_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "user"("id") ON DELETE RESTRICT;
ALTER TABLE "treasury_transfer" ADD CONSTRAINT "treasury_transfer_posted_fkey" FOREIGN KEY ("postedByUserId") REFERENCES "user"("id") ON DELETE RESTRICT;
ALTER TABLE "treasury_transfer" ADD CONSTRAINT "treasury_transfer_cancelled_fkey" FOREIGN KEY ("cancelledByUserId") REFERENCES "user"("id") ON DELETE RESTRICT;

CREATE FUNCTION "prevent_posted_phase23_mutation"() RETURNS TRIGGER AS $$
BEGIN
  IF OLD."status" = 'POSTED' THEN RAISE EXCEPTION 'Posted Phase 23 documents are immutable.'; END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
CREATE FUNCTION "prevent_posted_phase23_delete"() RETURNS TRIGGER AS $$
BEGIN
  IF OLD."status" = 'POSTED' THEN RAISE EXCEPTION 'Posted Phase 23 documents cannot be deleted.'; END IF;
  RETURN OLD;
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER "supplier_payment_posted_immutable" BEFORE UPDATE ON "supplier_payment" FOR EACH ROW EXECUTE FUNCTION "prevent_posted_phase23_mutation"();
CREATE TRIGGER "supplier_payment_posted_no_delete" BEFORE DELETE ON "supplier_payment" FOR EACH ROW EXECUTE FUNCTION "prevent_posted_phase23_delete"();
CREATE TRIGGER "expense_voucher_posted_immutable" BEFORE UPDATE ON "expense_voucher" FOR EACH ROW EXECUTE FUNCTION "prevent_posted_phase23_mutation"();
CREATE TRIGGER "expense_voucher_posted_no_delete" BEFORE DELETE ON "expense_voucher" FOR EACH ROW EXECUTE FUNCTION "prevent_posted_phase23_delete"();
CREATE TRIGGER "treasury_transfer_posted_immutable" BEFORE UPDATE ON "treasury_transfer" FOR EACH ROW EXECUTE FUNCTION "prevent_posted_phase23_mutation"();
CREATE TRIGGER "treasury_transfer_posted_no_delete" BEFORE DELETE ON "treasury_transfer" FOR EACH ROW EXECUTE FUNCTION "prevent_posted_phase23_delete"();
