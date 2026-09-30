import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import { recordAuditEvent } from "@/server/audit/audit-event";
import { todayInFactoryTimeZone } from "@/server/shared/factory-local-time";

type Client = Prisma.TransactionClient;

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

/**
 * The calendar-month period that would contain `date` (a UTC-midnight business date): its first
 * and last day and its display name, e.g. "October 2026".
 */
export function calendarMonthPeriod(date: Date) {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  return {
    name: `${MONTHS[month]} ${year}`,
    startDate: new Date(Date.UTC(year, month, 1)),
    endDate: new Date(Date.UTC(year, month + 1, 0)),
  };
}

/**
 * Decides whether a missing period for `date` may be opened automatically (INST-6). A fresh
 * database has no period at all, and after a month-end close the next month had to be created by
 * hand before anything could post. Opening the calendar month on first use removes that manual
 * step without weakening period control:
 * - never when any period (OPEN or CLOSED) already covers any day of that month — a CLOSED
 *   month stays closed and custom period layouts are never second-guessed;
 * - never for a month that starts before the end of the latest CLOSED period (no back-door
 *   posting into closed history);
 * - never beyond next month (a mistyped far-future date must not open a period).
 */
export function autoOpenPeriodDecision(input: {
  date: Date;
  today: Date;
  overlappingPeriods: number;
  latestClosedEnd: Date | null;
}) {
  const period = calendarMonthPeriod(input.date);
  const horizon = calendarMonthPeriod(
    new Date(Date.UTC(input.today.getUTCFullYear(), input.today.getUTCMonth() + 1, 1)),
  ).endDate;
  if (input.overlappingPeriods > 0) return { open: false as const, reason: "overlap" as const };
  if (input.latestClosedEnd && period.startDate <= input.latestClosedEnd)
    return { open: false as const, reason: "before-close" as const };
  if (period.startDate > horizon) return { open: false as const, reason: "future" as const };
  return { open: true as const, period };
}

/**
 * Returns the OPEN period containing `accountingDate`, opening its calendar month first when
 * `autoOpenPeriodDecision` allows it. Returns null when no OPEN period can contain the date.
 */
export async function findOrOpenAccountingPeriod(
  tx: Client,
  accountingDate: Date,
  actorUserId: string,
) {
  const existing = await tx.accountingPeriod.findFirst({
    where: { status: "OPEN", startDate: { lte: accountingDate }, endDate: { gte: accountingDate } },
  });
  if (existing) return existing;
  const month = calendarMonthPeriod(accountingDate);
  const [overlappingPeriods, latestClosed] = await Promise.all([
    tx.accountingPeriod.count({
      where: { startDate: { lte: month.endDate }, endDate: { gte: month.startDate } },
    }),
    tx.accountingPeriod.findFirst({
      where: { status: "CLOSED" },
      orderBy: { endDate: "desc" },
      select: { endDate: true },
    }),
  ]);
  const decision = autoOpenPeriodDecision({
    date: accountingDate,
    today: new Date(`${todayInFactoryTimeZone()}T00:00:00.000Z`),
    overlappingPeriods,
    latestClosedEnd: latestClosed?.endDate ?? null,
  });
  if (!decision.open) return null;
  // skipDuplicates makes a concurrent first posting of the month harmless.
  await tx.accountingPeriod.createMany({
    data: [{ id: crypto.randomUUID(), ...decision.period }],
    skipDuplicates: true,
  });
  const period = await tx.accountingPeriod.findFirst({
    where: { status: "OPEN", startDate: { lte: accountingDate }, endDate: { gte: accountingDate } },
  });
  if (period)
    await recordAuditEvent(tx, {
      actorUserId,
      action: "CREATE",
      entityType: "ACCOUNTING_PERIOD",
      entityId: period.id,
      entityReference: period.name,
      module: "accounting",
      description: `Opened accounting period ${period.name} automatically for the first posting dated in it.`,
      afterSnapshot: {
        status: period.status,
        startDate: period.startDate.toISOString().slice(0, 10),
        endDate: period.endDate.toISOString().slice(0, 10),
      },
      controlEvent: true,
    });
  return period;
}
