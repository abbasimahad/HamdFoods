-- Phase 33 software licensing: adds a LICENSE audit entity classification
-- for LICENSE_STATE_CHANGED-style audit events. License data itself
-- (license.lic, license-state.json) is deliberately kept outside
-- PostgreSQL entirely (see docs/specs/phase33-software-protection-design.md,
-- Section 7) -- this migration adds only the audit classification value. No
-- existing table, column, constraint, index, or trigger is altered.

-- AlterEnum
ALTER TYPE "AuditEntityType" ADD VALUE 'LICENSE';
