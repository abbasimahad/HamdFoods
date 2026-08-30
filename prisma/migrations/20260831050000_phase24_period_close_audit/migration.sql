CREATE TYPE "AccountingPeriodEventAction" AS ENUM ('CLOSED', 'REOPENED');

CREATE TABLE "accounting_period_event" (
  "id" TEXT NOT NULL,
  "periodId" TEXT NOT NULL,
  "action" "AccountingPeriodEventAction" NOT NULL,
  "reason" TEXT,
  "actorUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "accounting_period_event_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "accounting_period_event_periodId_createdAt_idx"
  ON "accounting_period_event"("periodId", "createdAt");
CREATE INDEX "accounting_period_event_actorUserId_createdAt_idx"
  ON "accounting_period_event"("actorUserId", "createdAt");

ALTER TABLE "accounting_period_event"
  ADD CONSTRAINT "accounting_period_event_periodId_fkey"
  FOREIGN KEY ("periodId") REFERENCES "accounting_period"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "accounting_period_event"
  ADD CONSTRAINT "accounting_period_event_actorUserId_fkey"
  FOREIGN KEY ("actorUserId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
