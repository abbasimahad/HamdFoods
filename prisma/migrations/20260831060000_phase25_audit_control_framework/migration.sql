CREATE TYPE "AuditActionType" AS ENUM (
  'CREATE', 'UPDATE', 'ACTIVATE', 'DEACTIVATE', 'APPROVE', 'RELEASE', 'POST', 'COMPLETE',
  'CANCEL', 'REVERSE', 'REOPEN', 'CLOSE', 'ALLOCATE', 'UNALLOCATE', 'OVERRIDE', 'BACKFILL',
  'ADJUST', 'LOGIN_SECURITY_EVENT', 'CONTROL_BLOCKED'
);

CREATE TYPE "AuditEntityType" AS ENUM (
  'USER', 'ROLE', 'MASTER_DATA', 'PURCHASE_ORDER', 'GRN', 'PURCHASE_RETURN',
  'INVENTORY_ADJUSTMENT', 'INVENTORY_TRANSFER', 'PRODUCTION_BATCH', 'MATERIAL_TRANSACTION',
  'PACKAGING_TRANSACTION', 'PRODUCTION_OUTPUT', 'SALES_ORDER', 'DISPATCH', 'SALES_INVOICE',
  'CUSTOMER_PAYMENT', 'SALES_RETURN', 'SUPPLIER_PAYMENT', 'EXPENSE_VOUCHER',
  'TREASURY_TRANSFER', 'JOURNAL', 'ACCOUNTING_PERIOD', 'VALUATION_ADJUSTMENT',
  'COSTING_FINALIZATION'
);

CREATE TYPE "AuditReasonCode" AS ENUM (
  'DATA_ENTRY_ERROR', 'DUPLICATE_ENTRY', 'CUSTOMER_REQUEST', 'SUPPLIER_REQUEST',
  'QUALITY_FAILURE', 'WRONG_ITEM', 'WRONG_QUANTITY', 'WRONG_PRICE', 'WRONG_WAREHOUSE',
  'ACCOUNTING_CORRECTION', 'OPERATIONAL_CORRECTION', 'MANAGEMENT_APPROVAL', 'OTHER'
);

CREATE TABLE "audit_event" (
  "id" TEXT NOT NULL,
  "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "actorUserId" TEXT NOT NULL,
  "action" "AuditActionType" NOT NULL,
  "entityType" "AuditEntityType" NOT NULL,
  "entityId" TEXT NOT NULL,
  "entityReference" TEXT,
  "module" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "reasonCode" "AuditReasonCode",
  "reason" TEXT,
  "metadata" JSONB,
  "beforeSnapshot" JSONB,
  "afterSnapshot" JSONB,
  "relatedEntityType" "AuditEntityType",
  "relatedEntityId" TEXT,
  "relatedReference" TEXT,
  "controlEvent" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "audit_event_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "audit_event_occurredAt_idx" ON "audit_event"("occurredAt");
CREATE INDEX "audit_event_actorUserId_occurredAt_idx" ON "audit_event"("actorUserId", "occurredAt");
CREATE INDEX "audit_event_action_occurredAt_idx" ON "audit_event"("action", "occurredAt");
CREATE INDEX "audit_event_entityType_entityId_occurredAt_idx" ON "audit_event"("entityType", "entityId", "occurredAt");
CREATE INDEX "audit_event_module_occurredAt_idx" ON "audit_event"("module", "occurredAt");

ALTER TABLE "audit_event" ADD CONSTRAINT "audit_event_actorUserId_fkey"
  FOREIGN KEY ("actorUserId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION "prevent_audit_event_mutation"() RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'Audit events are append-only.';
END; $$ LANGUAGE plpgsql;

CREATE TRIGGER "audit_event_append_only"
BEFORE UPDATE OR DELETE ON "audit_event"
FOR EACH ROW EXECUTE FUNCTION "prevent_audit_event_mutation"();
