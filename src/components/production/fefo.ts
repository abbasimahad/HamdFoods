/**
 * UX-10: first-expiry-first-out. Lots expiring soonest come first (then the oldest manufactured);
 * lots with no recorded date go last. Forms preselect the first lot of this order.
 */
export function sortFefo<T extends { expiryDate: Date | null; manufacturingDate: Date | null }>(
  lots: readonly T[],
) {
  const time = (value: Date | null) =>
    value ? new Date(value).getTime() : Number.MAX_SAFE_INTEGER;
  return [...lots].sort(
    (a, b) =>
      time(a.expiryDate) - time(b.expiryDate) ||
      time(a.manufacturingDate) - time(b.manufacturingDate),
  );
}
