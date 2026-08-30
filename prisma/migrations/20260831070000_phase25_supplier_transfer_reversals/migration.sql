ALTER TABLE "supplier_payment"
  ADD COLUMN "reversalOfId" TEXT,
  ADD COLUMN "reversalReason" TEXT;
CREATE UNIQUE INDEX "supplier_payment_reversalOfId_key" ON "supplier_payment"("reversalOfId");
ALTER TABLE "supplier_payment" ADD CONSTRAINT "supplier_payment_reversalOfId_fkey"
  FOREIGN KEY ("reversalOfId") REFERENCES "supplier_payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "treasury_transfer"
  ADD COLUMN "reversalOfId" TEXT,
  ADD COLUMN "reversalReason" TEXT;
CREATE UNIQUE INDEX "treasury_transfer_reversalOfId_key" ON "treasury_transfer"("reversalOfId");
ALTER TABLE "treasury_transfer" ADD CONSTRAINT "treasury_transfer_reversalOfId_fkey"
  FOREIGN KEY ("reversalOfId") REFERENCES "treasury_transfer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
