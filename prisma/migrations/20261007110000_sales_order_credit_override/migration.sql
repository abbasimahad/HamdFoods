-- ROLE-3: a sales order over the customer's credit limit can be approved by a holder of
-- sales.credit_override with a written reason. The override is stored on the order so posting the
-- order's invoices is not blocked again by the same limit, and it is audited (OVERRIDE).
ALTER TABLE "sales_order" ADD COLUMN "creditOverrideReason" TEXT;
ALTER TABLE "sales_order" ADD COLUMN "creditOverrideByUserId" TEXT;
ALTER TABLE "sales_order" ADD COLUMN "creditOverrideAt" TIMESTAMP(3);

ALTER TABLE "sales_order" ADD CONSTRAINT "sales_order_creditOverrideByUserId_fkey" FOREIGN KEY ("creditOverrideByUserId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
