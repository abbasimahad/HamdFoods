-- BUG-23: a fresh install defaulted purchase tax treatment to NOT_CONFIGURED, so the first taxed
-- goods receipt created stock but no payable. Registered manufacturers recover input tax, so a
-- database that has not received any goods yet starts as RECOVERABLE. Installs that already
-- hold receipts keep whatever they have configured.
UPDATE "accounting_settings" SET "purchaseTaxTreatment" = 'RECOVERABLE', "updatedAt" = CURRENT_TIMESTAMP
WHERE "id" = 'default'
  AND "purchaseTaxTreatment" = 'NOT_CONFIGURED'
  AND NOT EXISTS (SELECT 1 FROM "goods_receipt");
