-- ROLE-3: reopening a closed accounting period is a two-person control. Accounts requests the
-- reopen with a reason; a different user with accounting_periods.reopen_approve approves (the
-- period becomes OPEN, event REOPENED) or rejects it.
ALTER TYPE "AccountingPeriodEventAction" ADD VALUE IF NOT EXISTS 'REOPEN_REQUESTED';
ALTER TYPE "AccountingPeriodEventAction" ADD VALUE IF NOT EXISTS 'REOPEN_REJECTED';
