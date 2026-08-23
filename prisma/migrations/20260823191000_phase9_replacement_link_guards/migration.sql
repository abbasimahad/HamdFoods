CREATE OR REPLACE FUNCTION enforce_purchase_return_line_mutation() RETURNS trigger AS $$
DECLARE parent_status "PurchaseReturnStatus";
DECLARE parent_id TEXT;
BEGIN
  parent_id := CASE WHEN TG_OP = 'DELETE' THEN OLD."purchaseReturnId" ELSE NEW."purchaseReturnId" END;
  SELECT "status" INTO parent_status FROM "purchase_return" WHERE "id" = parent_id;
  IF parent_status <> 'DRAFT' THEN RAISE EXCEPTION 'Posted purchase return lines are immutable'; END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER purchase_return_line_update_guard ON "purchase_return_line";
CREATE TRIGGER purchase_return_line_mutation_guard BEFORE INSERT OR UPDATE OR DELETE ON "purchase_return_line"
FOR EACH ROW EXECUTE FUNCTION enforce_purchase_return_line_mutation();

CREATE OR REPLACE FUNCTION enforce_replacement_receipt_header_mutation() RETURNS trigger AS $$
BEGIN
  IF OLD."status" <> 'DRAFT' AND (
    NEW."purpose" <> OLD."purpose" OR NEW."purchaseReturnId" IS DISTINCT FROM OLD."purchaseReturnId"
  ) THEN RAISE EXCEPTION 'Posted receipt replacement provenance is immutable'; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER goods_receipt_replacement_header_guard BEFORE UPDATE ON "goods_receipt"
FOR EACH ROW EXECUTE FUNCTION enforce_replacement_receipt_header_mutation();

CREATE OR REPLACE FUNCTION enforce_replacement_receipt_line_link() RETURNS trigger AS $$
DECLARE receipt_status "GoodsReceiptStatus";
DECLARE receipt_purpose "GoodsReceiptPurpose";
DECLARE receipt_return_id TEXT;
DECLARE line_return_id TEXT;
DECLARE line_po_line_id TEXT;
DECLARE line_item_id TEXT;
BEGIN
  SELECT "status", "purpose", "purchaseReturnId"
    INTO receipt_status, receipt_purpose, receipt_return_id
    FROM "goods_receipt" WHERE "id" = COALESCE(NEW."goodsReceiptId", OLD."goodsReceiptId");
  IF TG_OP IN ('UPDATE','DELETE') AND receipt_status <> 'DRAFT' THEN
    RAISE EXCEPTION 'Posted receipt replacement line provenance is immutable';
  END IF;
  IF TG_OP <> 'DELETE' THEN
    IF receipt_purpose = 'PURCHASE' AND NEW."purchaseReturnLineId" IS NOT NULL THEN
      RAISE EXCEPTION 'Normal receipt line cannot reference a purchase return';
    END IF;
    IF receipt_purpose = 'SUPPLIER_REPLACEMENT' THEN
      IF NEW."purchaseReturnLineId" IS NULL THEN RAISE EXCEPTION 'Replacement receipt line requires a return line'; END IF;
      SELECT "purchaseReturnId", "purchaseOrderLineId", "itemId"
        INTO line_return_id, line_po_line_id, line_item_id
        FROM "purchase_return_line" WHERE "id" = NEW."purchaseReturnLineId";
      IF line_return_id IS DISTINCT FROM receipt_return_id
         OR line_po_line_id IS DISTINCT FROM NEW."purchaseOrderLineId"
         OR line_item_id IS DISTINCT FROM NEW."itemId" THEN
        RAISE EXCEPTION 'Replacement receipt line does not match its purchase return obligation';
      END IF;
    END IF;
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER goods_receipt_replacement_line_guard BEFORE INSERT OR UPDATE OR DELETE ON "goods_receipt_line"
FOR EACH ROW EXECUTE FUNCTION enforce_replacement_receipt_line_link();
