import { z } from "zod";

/**
 * An optional UUID field sourced from HTML form data. A browser form always
 * submits every named field, so an untouched optional input arrives as an
 * empty string, not `undefined` -- `z.string().uuid().optional()` rejects
 * that empty string (it isn't `undefined` and isn't a valid UUID), so the
 * whole submission fails validation even though nothing was actually wrong.
 * This preprocesses blank/whitespace-only input to `undefined` first.
 */
export function optionalUuid() {
  return z.preprocess(
    (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
    z.string().uuid().optional(),
  );
}

/** Same blank-string-to-undefined preprocessing for an optional YYYY-MM-DD date field. */
export function optionalDateOnly() {
  return z.preprocess(
    (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
    z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
  );
}
