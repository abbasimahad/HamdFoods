import Decimal from "decimal.js";

const grouping = new Intl.NumberFormat("en-PK", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** Formats an exact decimal amount for display as "Rs 2,354.10" (or without the prefix). */
export function formatMoney(
  value: string | number | { toString(): string } | null | undefined,
  prefix = "Rs ",
) {
  if (value === null || value === undefined || value === "") return "—";
  let amount: Decimal;
  try {
    amount = new Decimal(value.toString());
  } catch {
    return String(value);
  }
  // Round half-up on the exact decimal first, then only group digits for display.
  return `${prefix}${grouping.format(Number(amount.toDecimalPlaces(2).toFixed(2)))}`;
}

/** Formats a quantity without trailing zeros and with digit grouping (e.g. "1,200" or "12.5"). */
export function formatQuantity(value: string | number | { toString(): string } | null | undefined) {
  if (value === null || value === undefined || value === "") return "—";
  try {
    const amount = new Decimal(value.toString());
    return new Intl.NumberFormat("en-PK", { maximumFractionDigits: 3 }).format(
      Number(amount.toDecimalPlaces(3).toFixed(3)),
    );
  } catch {
    return String(value);
  }
}

/** Date as DD/MM/YYYY, the format used on printed documents in Pakistan. */
export function formatDocumentDate(value: Date | null | undefined) {
  if (!value) return "—";
  const iso = value.toISOString().slice(0, 10);
  const [year, month, day] = iso.split("-");
  return `${day}/${month}/${year}`;
}

const EXACT_AMOUNT = /^-?\d+\.\d{6}$/;

/**
 * Display-only pass over a report object (UX-9): every exact 6-decimal amount string that the
 * reporting layer returns ("36350.000000") becomes a grouped 2-decimal amount ("36,350.00").
 * The reporting layer itself stays exact, so reconciliation and tests keep comparing full
 * precision; only what the page renders is rounded. Dates and other values pass through.
 */
export function displayAmounts<T>(value: T): T {
  if (typeof value === "string")
    return (EXACT_AMOUNT.test(value) ? formatMoney(value, "") : value) as T;
  if (Array.isArray(value)) return value.map((entry) => displayAmounts(entry)) as T;
  if (value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype)
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, displayAmounts(entry)]),
    ) as T;
  return value;
}
