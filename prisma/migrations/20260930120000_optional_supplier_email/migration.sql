-- UX-9: supplier email is optional (many local suppliers have none). Existing values are kept.
ALTER TABLE "supplier" ALTER COLUMN "email" DROP NOT NULL;
