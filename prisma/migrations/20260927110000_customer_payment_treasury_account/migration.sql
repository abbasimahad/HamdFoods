-- UX-4: customer receipts can name the cash/bank (treasury) account the money went into.
-- Existing receipts keep NULL and continue to post to the DEFAULT_CASH / DEFAULT_BANK mapping.
ALTER TABLE "customer_payment" ADD COLUMN "treasuryAccountId" TEXT;
CREATE INDEX "customer_payment_treasuryAccountId_idx" ON "customer_payment"("treasuryAccountId");
ALTER TABLE "customer_payment" ADD CONSTRAINT "customer_payment_treasuryAccountId_fkey"
  FOREIGN KEY ("treasuryAccountId") REFERENCES "treasury_account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
