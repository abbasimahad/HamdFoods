-- PostgreSQL requires newly added enum values to commit before later
-- constraints or expressions can reference them. This precursor keeps fresh
-- database deployment deterministic while the original Phase 13 migration
-- remains checksum-compatible for databases where it is already applied.
ALTER TYPE "InventoryMovementType" ADD VALUE IF NOT EXISTS 'PACKAGING_ISSUE';
ALTER TYPE "InventoryMovementType" ADD VALUE IF NOT EXISTS 'PACKAGING_RETURN';
ALTER TYPE "InventoryMovementType" ADD VALUE IF NOT EXISTS 'PACKAGING_DAMAGE';
ALTER TYPE "ProductionMaterialTransactionType" ADD VALUE IF NOT EXISTS 'DAMAGE';
