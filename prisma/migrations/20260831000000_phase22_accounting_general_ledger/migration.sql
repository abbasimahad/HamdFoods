CREATE TYPE "AccountingAccountType" AS ENUM ('ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE');
CREATE TYPE "AccountingJournalStatus" AS ENUM ('DRAFT', 'POSTED', 'REVERSED');
CREATE TYPE "AccountingPeriodStatus" AS ENUM ('OPEN', 'CLOSED');
CREATE TYPE "PurchaseTaxTreatment" AS ENUM ('RECOVERABLE', 'CAPITALIZE', 'EXPENSE', 'NOT_CONFIGURED');
CREATE TYPE "AccountingMappingKey" AS ENUM ('ACCOUNTS_RECEIVABLE', 'ACCOUNTS_PAYABLE', 'RAW_MATERIAL_INVENTORY', 'PACKAGING_INVENTORY', 'FINISHED_GOODS_INVENTORY', 'WORK_IN_PROCESS', 'SALES_REVENUE', 'SALES_DISCOUNTS', 'SALES_RETURNS', 'OUTPUT_TAX', 'INPUT_TAX', 'COST_OF_GOODS_SOLD', 'GRNI', 'SUPPLIER_CLAIMS', 'LANDED_COST_CLEARING', 'PRODUCTION_COST_CLEARING', 'INVENTORY_VARIANCE', 'PURCHASE_RETURN_VARIANCE', 'OPENING_BALANCE_EQUITY', 'DEFAULT_CASH', 'DEFAULT_BANK', 'SALES_RETURN_INVENTORY_CLEARING');
CREATE TYPE "AccountingSourceType" AS ENUM ('OPENING_INVENTORY', 'GOODS_RECEIPT', 'GOODS_RECEIPT_ACCEPTANCE', 'PURCHASE_RETURN', 'LANDED_COST', 'VALUATION_ADJUSTMENT', 'PRODUCTION_CONSUMPTION', 'PACKAGING_CONSUMPTION', 'PRODUCTION_COST', 'PRODUCTION_OUTPUT', 'SALES_INVOICE_REVENUE', 'SALES_INVOICE_COGS', 'CUSTOMER_PAYMENT', 'SALES_RETURN_RECEIPT', 'SALES_RETURN_CREDIT', 'MANUAL_JOURNAL', 'MANUAL_REVERSAL');
CREATE TYPE "SupplierLedgerEntryType" AS ENUM ('PURCHASE_ACCEPTANCE', 'PURCHASE_RETURN_CREDIT', 'SUPPLIER_PAYMENT', 'DEBIT_NOTE', 'CREDIT_NOTE', 'OPENING_BALANCE', 'ADJUSTMENT');

CREATE TABLE "accounting_account" (
  "id" TEXT NOT NULL, "code" TEXT NOT NULL, "name" TEXT NOT NULL, "accountType" "AccountingAccountType" NOT NULL,
  "subtype" TEXT, "parentAccountId" TEXT, "isControl" BOOLEAN NOT NULL DEFAULT false, "postingAllowed" BOOLEAN NOT NULL DEFAULT true,
  "active" BOOLEAN NOT NULL DEFAULT true, "description" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "accounting_account_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "accounting_settings" (
  "id" TEXT NOT NULL DEFAULT 'default', "baseCurrencyCode" CHAR(3) NOT NULL DEFAULT 'PKR',
  "purchaseTaxTreatment" "PurchaseTaxTreatment" NOT NULL DEFAULT 'NOT_CONFIGURED', "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "accounting_settings_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "accounting_account_mapping" (
  "id" TEXT NOT NULL, "accountingSettingsId" TEXT NOT NULL DEFAULT 'default', "mappingKey" "AccountingMappingKey" NOT NULL,
  "accountId" TEXT NOT NULL, CONSTRAINT "accounting_account_mapping_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "accounting_period" (
  "id" TEXT NOT NULL, "name" TEXT NOT NULL, "startDate" DATE NOT NULL, "endDate" DATE NOT NULL,
  "status" "AccountingPeriodStatus" NOT NULL DEFAULT 'OPEN', "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "accounting_period_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "accounting_period_date_range_check" CHECK ("startDate" <= "endDate")
);
CREATE TABLE "accounting_journal_sequence" ("year" INTEGER NOT NULL, "nextValue" INTEGER NOT NULL, CONSTRAINT "accounting_journal_sequence_pkey" PRIMARY KEY ("year"));
CREATE TABLE "accounting_journal" (
  "id" TEXT NOT NULL, "journalNumber" TEXT NOT NULL, "accountingDate" DATE NOT NULL, "sourceType" "AccountingSourceType" NOT NULL,
  "sourceId" TEXT NOT NULL, "sourceNumber" TEXT, "description" TEXT NOT NULL, "status" "AccountingJournalStatus" NOT NULL DEFAULT 'DRAFT',
  "totalDebit" DECIMAL(30,6) NOT NULL, "totalCredit" DECIMAL(30,6) NOT NULL, "postedByUserId" TEXT, "postedAt" TIMESTAMP(3),
  "reversalOfId" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "accounting_journal_pkey" PRIMARY KEY ("id"), CONSTRAINT "accounting_journal_totals_check" CHECK ("totalDebit" > 0 AND "totalDebit" = "totalCredit")
);
CREATE TABLE "accounting_journal_line" (
  "id" TEXT NOT NULL, "journalId" TEXT NOT NULL, "position" INTEGER NOT NULL, "accountId" TEXT NOT NULL, "description" TEXT,
  "debit" DECIMAL(30,6) NOT NULL DEFAULT 0, "credit" DECIMAL(30,6) NOT NULL DEFAULT 0, "customerId" TEXT, "supplierId" TEXT,
  "itemId" TEXT, "productionBatchId" TEXT, "sourceMetadata" JSONB, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "accounting_journal_line_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "accounting_journal_line_side_check" CHECK (("debit" > 0 AND "credit" = 0) OR ("credit" > 0 AND "debit" = 0))
);
CREATE TABLE "supplier_payable_ledger_entry" (
  "id" TEXT NOT NULL, "sourceKey" TEXT NOT NULL, "supplierId" TEXT NOT NULL, "entryType" "SupplierLedgerEntryType" NOT NULL,
  "entryDate" DATE NOT NULL, "signedAmount" DECIMAL(30,6) NOT NULL, "sourceType" TEXT NOT NULL, "sourceId" TEXT NOT NULL,
  "sourceNumber" TEXT, "description" TEXT NOT NULL, "journalId" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "supplier_payable_ledger_entry_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "accounting_posting_block" (
  "id" TEXT NOT NULL, "sourceKey" TEXT NOT NULL, "sourceType" TEXT NOT NULL, "sourceId" TEXT NOT NULL, "reasonCode" TEXT NOT NULL,
  "description" TEXT NOT NULL, "resolvedAt" TIMESTAMP(3), "createdByUserId" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "accounting_posting_block_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "accounting_account_code_key" ON "accounting_account"("code");
CREATE INDEX "accounting_account_accountType_active_code_idx" ON "accounting_account"("accountType", "active", "code");
CREATE INDEX "accounting_account_parentAccountId_idx" ON "accounting_account"("parentAccountId");
CREATE UNIQUE INDEX "accounting_account_mapping_settings_key" ON "accounting_account_mapping"("accountingSettingsId", "mappingKey");
CREATE INDEX "accounting_account_mapping_accountId_idx" ON "accounting_account_mapping"("accountId");
CREATE UNIQUE INDEX "accounting_period_name_key" ON "accounting_period"("name");
CREATE INDEX "accounting_period_status_start_end_idx" ON "accounting_period"("status", "startDate", "endDate");
CREATE UNIQUE INDEX "accounting_journal_journalNumber_key" ON "accounting_journal"("journalNumber");
CREATE UNIQUE INDEX "accounting_journal_source_uidx" ON "accounting_journal"("sourceType", "sourceId");
CREATE UNIQUE INDEX "accounting_journal_reversalOfId_key" ON "accounting_journal"("reversalOfId");
CREATE INDEX "accounting_journal_accountingDate_status_idx" ON "accounting_journal"("accountingDate", "status");
CREATE UNIQUE INDEX "accounting_journal_line_journal_position_key" ON "accounting_journal_line"("journalId", "position");
CREATE INDEX "accounting_journal_line_account_journal_idx" ON "accounting_journal_line"("accountId", "journalId");
CREATE UNIQUE INDEX "supplier_payable_ledger_entry_sourceKey_key" ON "supplier_payable_ledger_entry"("sourceKey");
CREATE UNIQUE INDEX "supplier_payable_ledger_entry_journalId_key" ON "supplier_payable_ledger_entry"("journalId");
CREATE INDEX "supplier_payable_ledger_supplier_date_idx" ON "supplier_payable_ledger_entry"("supplierId", "entryDate");
CREATE UNIQUE INDEX "accounting_posting_block_sourceKey_key" ON "accounting_posting_block"("sourceKey");

ALTER TABLE "accounting_account" ADD CONSTRAINT "accounting_account_parent_fkey" FOREIGN KEY ("parentAccountId") REFERENCES "accounting_account"("id") ON DELETE RESTRICT;
ALTER TABLE "accounting_account_mapping" ADD CONSTRAINT "accounting_mapping_settings_fkey" FOREIGN KEY ("accountingSettingsId") REFERENCES "accounting_settings"("id") ON DELETE CASCADE;
ALTER TABLE "accounting_account_mapping" ADD CONSTRAINT "accounting_mapping_account_fkey" FOREIGN KEY ("accountId") REFERENCES "accounting_account"("id") ON DELETE RESTRICT;
ALTER TABLE "accounting_journal" ADD CONSTRAINT "accounting_journal_user_fkey" FOREIGN KEY ("postedByUserId") REFERENCES "user"("id") ON DELETE RESTRICT;
ALTER TABLE "accounting_journal" ADD CONSTRAINT "accounting_journal_reversal_fkey" FOREIGN KEY ("reversalOfId") REFERENCES "accounting_journal"("id") ON DELETE RESTRICT;
ALTER TABLE "accounting_journal_line" ADD CONSTRAINT "accounting_journal_line_journal_fkey" FOREIGN KEY ("journalId") REFERENCES "accounting_journal"("id") ON DELETE CASCADE;
ALTER TABLE "accounting_journal_line" ADD CONSTRAINT "accounting_journal_line_account_fkey" FOREIGN KEY ("accountId") REFERENCES "accounting_account"("id") ON DELETE RESTRICT;
ALTER TABLE "supplier_payable_ledger_entry" ADD CONSTRAINT "supplier_payable_ledger_supplier_fkey" FOREIGN KEY ("supplierId") REFERENCES "supplier"("id") ON DELETE RESTRICT;
ALTER TABLE "accounting_posting_block" ADD CONSTRAINT "accounting_posting_block_user_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "user"("id") ON DELETE RESTRICT;

INSERT INTO "accounting_account" ("id", "code", "name", "accountType", "subtype", "isControl", "postingAllowed", "updatedAt") VALUES
('coa-1000','1000','Cash on Hand','ASSET','CASH',false,true,CURRENT_TIMESTAMP), ('coa-1010','1010','Bank / Bank Clearing','ASSET','BANK',false,true,CURRENT_TIMESTAMP),
('coa-1100','1100','Accounts Receivable','ASSET','RECEIVABLE',true,true,CURRENT_TIMESTAMP), ('coa-1200','1200','Raw Material Inventory','ASSET','INVENTORY',true,true,CURRENT_TIMESTAMP),
('coa-1210','1210','Packaging Inventory','ASSET','INVENTORY',true,true,CURRENT_TIMESTAMP), ('coa-1220','1220','Finished Goods Inventory','ASSET','INVENTORY',true,true,CURRENT_TIMESTAMP),
('coa-1230','1230','Work in Process','ASSET','WIP',true,true,CURRENT_TIMESTAMP), ('coa-1240','1240','Supplier Claims / Replacement Receivable','ASSET','CLAIMS',true,true,CURRENT_TIMESTAMP),
('coa-1250','1250','Input Tax Receivable','ASSET','TAX',false,true,CURRENT_TIMESTAMP), ('coa-1260','1260','Sales Return Inventory Clearing','ASSET','CLEARING',true,true,CURRENT_TIMESTAMP),
('coa-2000','2000','Accounts Payable','LIABILITY','PAYABLE',true,true,CURRENT_TIMESTAMP), ('coa-2010','2010','Goods Received Not Invoiced / Purchase Receipt Clearing','LIABILITY','GRNI',true,true,CURRENT_TIMESTAMP),
('coa-2020','2020','Output Tax Payable','LIABILITY','TAX',false,true,CURRENT_TIMESTAMP), ('coa-2030','2030','Landed Cost Clearing','LIABILITY','CLEARING',false,true,CURRENT_TIMESTAMP),
('coa-2040','2040','Labor / Production Cost Clearing','LIABILITY','CLEARING',false,true,CURRENT_TIMESTAMP), ('coa-2050','2050','Factory Overhead Clearing','LIABILITY','CLEARING',false,true,CURRENT_TIMESTAMP),
('coa-3000','3000','Opening Balance Equity','EQUITY','OPENING',false,true,CURRENT_TIMESTAMP), ('coa-3100','3100','Retained Earnings','EQUITY','RETAINED',false,false,CURRENT_TIMESTAMP),
('coa-4000','4000','Sales Revenue','REVENUE','SALES',false,true,CURRENT_TIMESTAMP), ('coa-4100','4100','Sales Discounts','EXPENSE','CONTRA_REVENUE',false,true,CURRENT_TIMESTAMP),
('coa-4110','4110','Sales Returns & Allowances','EXPENSE','CONTRA_REVENUE',false,true,CURRENT_TIMESTAMP), ('coa-5000','5000','Cost of Goods Sold','EXPENSE','COGS',false,true,CURRENT_TIMESTAMP),
('coa-5010','5010','Inventory Valuation Variance','EXPENSE','VARIANCE',false,true,CURRENT_TIMESTAMP), ('coa-5020','5020','Purchase Return Variance','EXPENSE','VARIANCE',false,true,CURRENT_TIMESTAMP),
('coa-5030','5030','Abnormal Production Loss','EXPENSE','LOSS',false,true,CURRENT_TIMESTAMP), ('coa-6000','6000','General Operating Expense','EXPENSE','OPERATING',false,true,CURRENT_TIMESTAMP);
INSERT INTO "accounting_settings" ("id", "updatedAt") VALUES ('default', CURRENT_TIMESTAMP);
INSERT INTO "accounting_account_mapping" ("id", "mappingKey", "accountId") VALUES
('map-ar','ACCOUNTS_RECEIVABLE','coa-1100'),('map-ap','ACCOUNTS_PAYABLE','coa-2000'),('map-raw','RAW_MATERIAL_INVENTORY','coa-1200'),('map-pack','PACKAGING_INVENTORY','coa-1210'),('map-fg','FINISHED_GOODS_INVENTORY','coa-1220'),('map-wip','WORK_IN_PROCESS','coa-1230'),('map-sales','SALES_REVENUE','coa-4000'),('map-disc','SALES_DISCOUNTS','coa-4100'),('map-returns','SALES_RETURNS','coa-4110'),('map-output-tax','OUTPUT_TAX','coa-2020'),('map-input-tax','INPUT_TAX','coa-1250'),('map-cogs','COST_OF_GOODS_SOLD','coa-5000'),('map-grni','GRNI','coa-2010'),('map-claims','SUPPLIER_CLAIMS','coa-1240'),('map-landed','LANDED_COST_CLEARING','coa-2030'),('map-production','PRODUCTION_COST_CLEARING','coa-2040'),('map-variance','INVENTORY_VARIANCE','coa-5010'),('map-return-variance','PURCHASE_RETURN_VARIANCE','coa-5020'),('map-opening','OPENING_BALANCE_EQUITY','coa-3000'),('map-cash','DEFAULT_CASH','coa-1000'),('map-bank','DEFAULT_BANK','coa-1010'),('map-return-clearing','SALES_RETURN_INVENTORY_CLEARING','coa-1260');

CREATE FUNCTION "prevent_posted_accounting_journal_mutation"() RETURNS TRIGGER AS $$
BEGIN
  IF OLD."status" = 'POSTED' AND (NEW."accountingDate", NEW."sourceType", NEW."sourceId", NEW."description", NEW."totalDebit", NEW."totalCredit", NEW."postedByUserId", NEW."postedAt") IS DISTINCT FROM (OLD."accountingDate", OLD."sourceType", OLD."sourceId", OLD."description", OLD."totalDebit", OLD."totalCredit", OLD."postedByUserId", OLD."postedAt") THEN
    RAISE EXCEPTION 'Posted accounting journals are immutable.';
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER "accounting_journal_posted_immutable" BEFORE UPDATE ON "accounting_journal" FOR EACH ROW EXECUTE FUNCTION "prevent_posted_accounting_journal_mutation"();
CREATE FUNCTION "prevent_posted_accounting_line_mutation"() RETURNS TRIGGER AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM "accounting_journal" WHERE "id" = COALESCE(NEW."journalId", OLD."journalId") AND "status" = 'POSTED') THEN RAISE EXCEPTION 'Posted accounting journal lines are immutable.'; END IF;
  RETURN COALESCE(NEW, OLD);
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER "accounting_journal_line_posted_immutable" BEFORE UPDATE OR DELETE ON "accounting_journal_line" FOR EACH ROW EXECUTE FUNCTION "prevent_posted_accounting_line_mutation"();
