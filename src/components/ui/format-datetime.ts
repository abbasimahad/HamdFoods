/**
 * Deterministic, locale-independent date formatting. `Date#toLocaleString()` /
 * `toLocaleDateString()` read the runtime's default locale and timezone, which differ between
 * the Node SSR process (UTC, en-US: "1/15/2027") and the factory browser (PKT, en-GB:
 * "15/01/2027"), so the same page rendered two different texts and React threw a hydration
 * mismatch (BUG-32). Every date shown in the ERP uses these helpers instead: DD/MM/YYYY, and
 * times as factory-local wall-clock (Pakistan Standard Time, UTC+5, no daylight saving).
 */
const FACTORY_UTC_OFFSET_MS = 5 * 60 * 60 * 1000;

function factoryLocalIso(value: Date | string) {
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return null;
  return new Date(date.getTime() + FACTORY_UTC_OFFSET_MS).toISOString();
}

/**
 * A calendar date as DD/MM/YYYY. Date-only values (stored as UTC midnight) keep their own date;
 * timestamps show the factory-local calendar day.
 */
export function formatFactoryDate(value: Date | string): string;
export function formatFactoryDate(value: Date | string | null | undefined): string | undefined;
export function formatFactoryDate(value: Date | string | null | undefined) {
  if (value === null || value === undefined) return undefined;
  const iso = factoryLocalIso(value);
  if (!iso) return String(value);
  const [year, month, day] = iso.slice(0, 10).split("-");
  return `${day}/${month}/${year}`;
}

/** A timestamp as factory-local "DD/MM/YYYY HH:mm". */
export function formatFactoryDateTime(value: Date | string): string;
export function formatFactoryDateTime(value: Date | string | null | undefined): string | undefined;
export function formatFactoryDateTime(value: Date | string | null | undefined) {
  if (value === null || value === undefined) return undefined;
  const iso = factoryLocalIso(value);
  if (!iso) return String(value);
  return `${formatFactoryDate(value)} ${iso.slice(11, 16)}`;
}

/** @deprecated Kept for callers that explicitly want UTC; ERP screens use formatFactoryDateTime. */
export function formatDateTimeUtc(value: Date) {
  return `${value.toISOString().replace("T", " ").slice(0, 16)} UTC`;
}
