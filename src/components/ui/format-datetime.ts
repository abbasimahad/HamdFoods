/**
 * Deterministic, locale-independent timestamp formatting for server-rendered
 * content. `Date#toLocaleString()`/`toLocaleDateString()` read the runtime's
 * default locale, which can differ between the Node SSR process and the
 * browser, causing a React hydration mismatch on first render. Use this for
 * any timestamp rendered directly in server-component/server-action output;
 * it is not a substitute for genuine user-locale display preferences.
 */
export function formatDateTimeUtc(value: Date) {
  return `${value.toISOString().replace("T", " ").slice(0, 16)} UTC`;
}
