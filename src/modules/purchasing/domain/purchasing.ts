import Decimal from "decimal.js";

import { decimalToString, parseNonNegativeDecimal } from "@/modules/quantity/domain/quantity";

export const PURCHASE_PAGE_SIZE = 20;
export const PURCHASE_ORDER_STATUSES = [
  "DRAFT",
  "APPROVED",
  "PARTIALLY_RECEIVED",
  "RECEIVED",
  "CLOSED",
  "CANCELLED",
] as const;
export type PurchaseOrderStatus = (typeof PURCHASE_ORDER_STATUSES)[number];

export type CalculatedPurchaseLine = {
  grossAmount: string;
  discountAmount: string;
  taxAmount: string;
  netAmount: string;
};

export function calculatePurchaseLine(input: {
  quantity: string;
  unitRate: string;
  discountPercent: string;
  taxPercent: string;
}): CalculatedPurchaseLine {
  const quantity = parseNonNegativeDecimal(input.quantity, "Quantity", 24);
  const unitRate = parseNonNegativeDecimal(input.unitRate, "Unit rate", 24);
  const discountPercent = percentage(input.discountPercent, "Discount percentage");
  const taxPercent = percentage(input.taxPercent, "Tax percentage");
  if (quantity.lte(0)) throw new PurchasingDomainError("Quantity must be greater than zero.");
  const gross = money(quantity.mul(unitRate));
  const discount = money(gross.mul(discountPercent).div(100));
  const netBeforeTax = gross.sub(discount);
  const tax = money(netBeforeTax.mul(taxPercent).div(100));
  return {
    grossAmount: decimalToString(gross),
    discountAmount: decimalToString(discount),
    taxAmount: decimalToString(tax),
    netAmount: decimalToString(money(netBeforeTax.add(tax))),
  };
}

export function calculatePurchaseTotals(lines: readonly CalculatedPurchaseLine[]) {
  const sum = (field: keyof CalculatedPurchaseLine) =>
    money(lines.reduce((total, line) => total.add(line[field]), new Decimal(0)));
  const subtotal = sum("grossAmount");
  const discountTotal = sum("discountAmount");
  const taxTotal = sum("taxAmount");
  return {
    subtotal: decimalToString(subtotal),
    discountTotal: decimalToString(discountTotal),
    taxTotal: decimalToString(taxTotal),
    grandTotal: decimalToString(money(subtotal.sub(discountTotal).add(taxTotal))),
  };
}

export function formatMoney(value: string) {
  return `Rs ${new Decimal(value).toFixed(2)}`;
}

function percentage(value: string, label: string) {
  const parsed = parseNonNegativeDecimal(value || "0", label, 7);
  if (parsed.gt(100) || parsed.decimalPlaces() > 4) {
    throw new PurchasingDomainError(`${label} must be between 0 and 100 with up to 4 decimals.`);
  }
  return parsed;
}

function money(value: Decimal) {
  const rounded = value.toDecimalPlaces(6, Decimal.ROUND_HALF_UP);
  if (rounded.gt("999999999999999999.999999")) {
    throw new PurchasingDomainError("Purchase amount exceeds the supported monetary range.");
  }
  return rounded;
}

export class PurchasingDomainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PurchasingDomainError";
  }
}
