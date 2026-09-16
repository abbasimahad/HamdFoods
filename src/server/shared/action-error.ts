import "server-only";

/**
 * Returns the safe message for a server action's client-facing failure
 * response. An error whose constructor is in `knownErrorTypes` is a
 * deliberate, already-safe domain/validation message and is returned
 * verbatim; anything else (including a raw PrismaClientKnownRequestError,
 * which extends Error like every other thrown value here) is logged
 * server-side only and replaced with `fallback` before it ever reaches the
 * browser. `error instanceof Error` alone is not a safe test -- database
 * errors satisfy it too.
 */
export function safeActionErrorMessage(
  error: unknown,
  fallback: string,
  ...knownErrorTypes: Array<abstract new (...args: never[]) => Error>
): string {
  for (const knownErrorType of knownErrorTypes) {
    if (error instanceof knownErrorType) return error.message;
  }
  console.error(fallback, error);
  return fallback;
}
