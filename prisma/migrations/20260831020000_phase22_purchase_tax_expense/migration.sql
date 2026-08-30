ALTER TYPE "AccountingMappingKey" ADD VALUE 'PURCHASE_TAX_EXPENSE';

INSERT INTO "accounting_account_mapping" ("id", "mappingKey", "accountId")
VALUES ('map-purchase-tax-expense', 'PURCHASE_TAX_EXPENSE', 'coa-6000');
