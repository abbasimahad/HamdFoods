-- BUG-39: a finished good's normal shelf life, used to pre-fill production output expiry.
ALTER TABLE "finished_good_profile" ADD COLUMN "shelfLifeDays" INTEGER;
ALTER TABLE "finished_good_profile"
  ADD CONSTRAINT "finished_good_profile_shelf_life_days_check"
  CHECK ("shelfLifeDays" IS NULL OR "shelfLifeDays" BETWEEN 1 AND 3650);
