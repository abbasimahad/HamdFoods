-- Two AccountingMappingKey values (INVENTORY_LOSS_EXPENSE, PURCHASE_PRICE_VARIANCE)
-- were defined in the enum from the start but never given a seeded mapping row.
-- The mapping-edit action only ever ran an update() against an existing row (now
-- fixed to upsert()), so an operator could select these keys in the UI but saving
-- always failed silently for them, and any posting code that relies on them being
-- configured had no way to succeed on a fresh install. This adds a real account
-- for each and seeds both mappings, purely additive -- no existing row is changed.

INSERT INTO "accounting_account" ("id", "code", "name", "accountType", "subtype", "isControl", "postingAllowed", "updatedAt")
VALUES ('coa-5040', '5040', 'Purchase Price Variance', 'EXPENSE', 'VARIANCE', false, true, CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "accounting_account_mapping" ("id", "mappingKey", "accountId")
VALUES
  ('map-inventory-loss', 'INVENTORY_LOSS_EXPENSE', 'coa-5030'),
  ('map-purchase-price-variance', 'PURCHASE_PRICE_VARIANCE', 'coa-5040')
ON CONFLICT ("accountingSettingsId", "mappingKey") DO NOTHING;
