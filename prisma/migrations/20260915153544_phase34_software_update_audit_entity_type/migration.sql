-- Phase 34 secure updates: adds a SOFTWARE_UPDATE audit entity
-- classification for deliberate update actions (package verified/staged,
-- update armed/started, rollback confirmed). Update package/state data
-- itself is deliberately kept outside PostgreSQL entirely (see
-- docs/specs/phase34-secure-update-recovery-design.md, Sections 9 and 12)
-- -- this migration adds only the audit classification value. No existing
-- table, column, constraint, index, or trigger is altered.

-- AlterEnum
ALTER TYPE "AuditEntityType" ADD VALUE 'SOFTWARE_UPDATE';
