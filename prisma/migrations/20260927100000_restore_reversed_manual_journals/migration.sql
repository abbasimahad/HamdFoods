-- BUG-27: reversed manual journals were flipped to REVERSED, which dropped them from every
-- POSTED-only balance while their POSTED reversal was still counted (reversal counted twice).
-- The original must stay POSTED; the reversal link (reversalOfId) records that it was reversed.
UPDATE "accounting_journal" SET "status" = 'POSTED'
WHERE "status" = 'REVERSED'
  AND "id" IN (SELECT "reversalOfId" FROM "accounting_journal" WHERE "reversalOfId" IS NOT NULL);
