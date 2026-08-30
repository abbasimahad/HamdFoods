CREATE FUNCTION "prevent_posted_accounting_journal_delete"() RETURNS TRIGGER AS $$
BEGIN
  IF OLD."status" IN ('POSTED', 'REVERSED') THEN
    RAISE EXCEPTION 'Posted accounting journals are immutable and cannot be deleted.';
  END IF;
  RETURN OLD;
END; $$ LANGUAGE plpgsql;

CREATE TRIGGER "accounting_journal_posted_no_delete"
BEFORE DELETE ON "accounting_journal"
FOR EACH ROW EXECUTE FUNCTION "prevent_posted_accounting_journal_delete"();

CREATE OR REPLACE FUNCTION "prevent_posted_accounting_line_mutation"() RETURNS TRIGGER AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "accounting_journal"
    WHERE "id" = COALESCE(NEW."journalId", OLD."journalId")
      AND "status" IN ('POSTED', 'REVERSED')
  ) THEN
    RAISE EXCEPTION 'Posted accounting journal lines are immutable.';
  END IF;
  RETURN COALESCE(NEW, OLD);
END; $$ LANGUAGE plpgsql;
