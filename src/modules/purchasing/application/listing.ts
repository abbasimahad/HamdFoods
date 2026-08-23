import {
  PURCHASE_ORDER_STATUSES,
  PURCHASE_PAGE_SIZE,
  type PurchaseOrderStatus,
} from "../domain/purchasing";

export function parsePurchasePage(value?: string) {
  const page = Number(value ?? "1");
  return Number.isSafeInteger(page) && page > 0 ? page : 1;
}

export function parsePurchaseOrderStatus(value?: string): PurchaseOrderStatus | undefined {
  return PURCHASE_ORDER_STATUSES.includes(value as PurchaseOrderStatus)
    ? (value as PurchaseOrderStatus)
    : undefined;
}

export function parsePurchaseDate(value?: string, endExclusive = false) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.valueOf())) return undefined;
  if (endExclusive) date.setUTCDate(date.getUTCDate() + 1);
  return date;
}

export { PURCHASE_PAGE_SIZE };
