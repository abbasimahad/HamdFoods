-- Administration Settings: Company/Factory Profile.
-- Scoped strictly to the new singleton settings row. No existing table,
-- column, constraint, or index is altered, renamed, or dropped by this
-- migration.

-- AlterEnum
ALTER TYPE "AuditEntityType" ADD VALUE 'COMPANY_PROFILE';

-- CreateTable
CREATE TABLE "company_profile" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "legalName" TEXT NOT NULL,
    "address" TEXT,
    "city" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "taxRegistrationNo" TEXT,
    "updatedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "company_profile_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "company_profile" ADD CONSTRAINT "company_profile_updatedByUserId_fkey" FOREIGN KEY ("updatedByUserId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Seed the singleton row with the current hardcoded application name, so
-- this migration produces zero visible change on deploy.
INSERT INTO "company_profile" ("id", "legalName", "createdAt", "updatedAt")
VALUES ('default', 'Hamd Foods ERP', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;
