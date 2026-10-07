-- BUG-30: waste write-off (and write-off reversal) valuation entries were stamped with the
-- disposition's date-only value (00:00 UTC = 05:00 PKT), ahead of movements actually posted
-- earlier that local day, so running balances read by effective time were out of order.
-- Restamp each one with its inventory movement's real posting instant when that instant falls on
-- the same factory-local business day (UTC+5). The business day -- and therefore the accounting
-- date and period of the already-posted journal -- does not change; amounts are untouched.
-- INST-10: valuation entries are guarded by the inventory_valuation_entry_immutable trigger, so
-- this one-off repair suspends it only for the restamp and re-enables it immediately after.
ALTER TABLE "inventory_valuation_entry" DISABLE TRIGGER inventory_valuation_entry_immutable;

UPDATE "inventory_valuation_entry" AS e
SET "effectiveAt" = m."postedAt"
FROM "inventory_movement" AS m
WHERE e."inventoryMovementId" = m."id"
  AND e."entryType" IN ('INVENTORY_WRITE_OFF', 'INVENTORY_WRITE_OFF_REVERSAL')
  AND e."effectiveAt" = date_trunc('day', e."effectiveAt")
  AND (m."postedAt" + INTERVAL '5 hours')::date = e."effectiveAt"::date;

ALTER TABLE "inventory_valuation_entry" ENABLE TRIGGER inventory_valuation_entry_immutable;

UPDATE "inventory_valuation_balance" AS b
SET "lastValuationAt" = latest."effectiveAt"
FROM (
  SELECT "itemId", MAX("effectiveAt") AS "effectiveAt"
  FROM "inventory_valuation_entry"
  GROUP BY "itemId"
) AS latest
WHERE b."itemId" = latest."itemId"
  AND b."lastValuationAt" IS DISTINCT FROM latest."effectiveAt"
  AND b."lastValuationAt" < latest."effectiveAt";
