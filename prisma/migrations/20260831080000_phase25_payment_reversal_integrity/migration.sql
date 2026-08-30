ALTER TABLE "customer_payment"
  ADD COLUMN "reversalOfId" TEXT,
  ADD COLUMN "reversalReason" TEXT;

ALTER TYPE "AccountingSourceType" ADD VALUE 'CUSTOMER_PAYMENT_REVERSAL';

CREATE UNIQUE INDEX "customer_payment_reversalOfId_key"
  ON "customer_payment"("reversalOfId");

ALTER TABLE "customer_payment"
  ADD CONSTRAINT "customer_payment_reversalOfId_fkey"
  FOREIGN KEY ("reversalOfId") REFERENCES "customer_payment"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION "prevent_posted_customer_payment_allocation_mutation"()
RETURNS trigger AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "customer_payment"
    WHERE "id" = OLD."customerPaymentId" AND "status" = 'POSTED'
  ) THEN
    RAISE EXCEPTION 'Existing allocations on posted customer payments are immutable.';
  END IF;
  RETURN OLD;
END; $$ LANGUAGE plpgsql;

CREATE TRIGGER "customer_payment_allocation_posted_immutable"
BEFORE UPDATE OR DELETE ON "customer_payment_allocation"
FOR EACH ROW EXECUTE FUNCTION "prevent_posted_customer_payment_allocation_mutation"();
