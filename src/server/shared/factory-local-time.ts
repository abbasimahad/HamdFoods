/**
 * This factory operates on Pakistan Standard Time (UTC+5, no daylight saving).
 * The server process itself may run in any timezone (this deployment happens
 * to run in UTC), so "today" and "end of today" must be computed explicitly
 * against PKT rather than via a bare `new Date()` -- otherwise every business
 * day appears to start and end five hours early from the factory's own point
 * of view, hiding same-day documents from "as of today" balances and forms
 * between local midnight and 5am.
 */
const FACTORY_UTC_OFFSET_HOURS = 5;

/** The current date (YYYY-MM-DD) in the factory's local timezone. */
export function todayInFactoryTimeZone(): string {
  const local = new Date(Date.now() + FACTORY_UTC_OFFSET_HOURS * 60 * 60 * 1000);
  return local.toISOString().slice(0, 10);
}

/**
 * The UTC instant corresponding to 23:59:59.999 local time on the given
 * YYYY-MM-DD date (or today, in the factory's timezone, if omitted/invalid).
 * Use this as an inclusive upper bound for an "as of <date>" comparison
 * against timestamps stored in UTC.
 */
export function endOfFactoryLocalDay(dateOnly?: string): Date {
  const value =
    dateOnly && /^\d{4}-\d{2}-\d{2}$/.test(dateOnly) ? dateOnly : todayInFactoryTimeZone();
  const endOfLocalDayUtcMillis =
    Date.parse(`${value}T23:59:59.999Z`) - FACTORY_UTC_OFFSET_HOURS * 60 * 60 * 1000;
  return new Date(endOfLocalDayUtcMillis);
}

/**
 * A `YYYY-MM-DDTHH:mm` string for `<input type="datetime-local">` showing
 * the given instant as factory-local wall-clock time. Using the runtime's
 * own timezone offset (e.g. `Date.prototype.getTimezoneOffset`) is wrong
 * here because these forms render server-side on a UTC server -- that
 * always displays the raw UTC instant as if it were already local time,
 * five hours behind the factory's actual wall clock.
 */
export function factoryLocalDateTimeValue(date: Date): string {
  const local = new Date(date.getTime() + FACTORY_UTC_OFFSET_HOURS * 60 * 60 * 1000);
  return local.toISOString().slice(0, 16);
}
