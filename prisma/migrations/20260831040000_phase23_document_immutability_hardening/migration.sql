CREATE FUNCTION "prevent_posted_expense_line_mutation"() RETURNS TRIGGER AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "expense_voucher"
    WHERE "id" = OLD."expenseVoucherId" AND "status" = 'POSTED'
  ) THEN
    RAISE EXCEPTION 'Lines on posted expense vouchers are immutable.';
  END IF;
  RETURN OLD;
END; $$ LANGUAGE plpgsql;

CREATE TRIGGER "expense_voucher_line_posted_immutable"
BEFORE UPDATE OR DELETE ON "expense_voucher_line"
FOR EACH ROW EXECUTE FUNCTION "prevent_posted_expense_line_mutation"();

CREATE FUNCTION "prevent_posted_supplier_payment_allocation_mutation"() RETURNS TRIGGER AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "supplier_payment"
    WHERE "id" = OLD."supplierPaymentId" AND "status" = 'POSTED'
  ) THEN
    RAISE EXCEPTION 'Existing allocations on posted supplier payments are immutable.';
  END IF;
  RETURN OLD;
END; $$ LANGUAGE plpgsql;

CREATE TRIGGER "supplier_payment_allocation_posted_immutable"
BEFORE UPDATE OR DELETE ON "supplier_payment_allocation"
FOR EACH ROW EXECUTE FUNCTION "prevent_posted_supplier_payment_allocation_mutation"();
