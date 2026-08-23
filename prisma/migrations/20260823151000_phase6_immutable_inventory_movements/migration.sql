CREATE OR REPLACE FUNCTION prevent_inventory_movement_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'inventory movements are immutable; post a compensating movement instead'
    USING ERRCODE = 'integrity_constraint_violation';
END;
$$;

CREATE TRIGGER inventory_movement_immutable_update_delete
BEFORE UPDATE OR DELETE ON "inventory_movement"
FOR EACH ROW
EXECUTE FUNCTION prevent_inventory_movement_mutation();
