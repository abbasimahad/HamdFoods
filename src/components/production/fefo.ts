/**
 * UX-10: first-expiry-first-out. Lots expiring soonest come first (then the oldest manufactured);
 * lots with no recorded date go last. Lots the dates don't separate -- typically raw materials and
 * packaging received without an expiry -- go oldest receipt first (FIFO), never in database order.
 * Forms preselect the first lot of this order.
 */
export function sortFefo<
  T extends {
    expiryDate: Date | null;
    manufacturingDate: Date | null;
    receivedAt?: Date | null;
    goodsReceiptNumber?: string;
  },
>(lots: readonly T[]) {
  const time = (value: Date | null | undefined) =>
    value ? new Date(value).getTime() : Number.MAX_SAFE_INTEGER;
  return [...lots].sort(
    (a, b) =>
      time(a.expiryDate) - time(b.expiryDate) ||
      time(a.manufacturingDate) - time(b.manufacturingDate) ||
      time(a.receivedAt) - time(b.receivedAt) ||
      (a.goodsReceiptNumber ?? "").localeCompare(b.goodsReceiptNumber ?? ""),
  );
}
