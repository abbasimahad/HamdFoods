import Decimal from "decimal.js";

import { normalizeCartonQuantity } from "@/modules/quantity/domain/cartons";
import { decimalToString, parseNonNegativeDecimal } from "@/modules/quantity/domain/quantity";
import { pieceRateFromCartonRate } from "@/modules/quantity/domain/rates";

export const SALES_ORDER_PAGE_SIZE = 20;
export const SALES_ORDER_STATUSES = [
  "DRAFT",
  "APPROVED",
  "PARTIALLY_DISPATCHED",
  "DISPATCHED",
  "CLOSED",
  "CANCELLED",
] as const;
export type SalesOrderStatus = (typeof SALES_ORDER_STATUSES)[number];

export type CalculatedSalesOrderLine = {
  cartons: string;
  loosePieces: string;
  totalPieces: string;
  pieceRate: string;
  grossAmount: string;
  discountAmount: string;
  taxAmount: string;
  netAmount: string;
};

export function calculateSalesOrderLine(input: {
  cartons: string;
  loosePieces: string;
  piecesPerCarton: number;
  cartonRate: string;
  discount1Percent: string;
  discount2Percent: string;
  taxPercent: string;
}): CalculatedSalesOrderLine {
  const breakdown = normalizeCartonQuantity(
    input.cartons,
    input.loosePieces,
    input.piecesPerCarton,
  );
  if (breakdown.totalPieces === "0")
    throw new SalesOrderDomainError("Quantity must be greater than zero.");
  const cartonRate = boundedMoney(input.cartonRate, "Carton rate");
  const pieceRate = new Decimal(
    pieceRateFromCartonRate(cartonRate.toFixed(), input.piecesPerCarton),
  );
  const gross = money(
    new Decimal(breakdown.cartons)
      .mul(cartonRate)
      .add(new Decimal(breakdown.loosePieces).mul(pieceRate)),
  );
  const discount1 = money(gross.mul(percent(input.discount1Percent, "First discount")).div(100));
  const afterDiscount1 = gross.sub(discount1);
  const discount2 = money(
    afterDiscount1.mul(percent(input.discount2Percent, "Second discount")).div(100),
  );
  const netBeforeTax = gross.sub(discount1).sub(discount2);
  const tax = money(netBeforeTax.mul(percent(input.taxPercent, "Tax")).div(100));
  return {
    cartons: breakdown.cartons,
    loosePieces: breakdown.loosePieces,
    totalPieces: breakdown.totalPieces,
    pieceRate: decimalToString(pieceRate),
    grossAmount: decimalToString(gross),
    discountAmount: decimalToString(money(discount1.add(discount2))),
    taxAmount: decimalToString(tax),
    netAmount: decimalToString(money(netBeforeTax.add(tax))),
  };
}

export function calculateSalesOrderTotals(
  lines: readonly Pick<
    CalculatedSalesOrderLine,
    "grossAmount" | "discountAmount" | "taxAmount" | "netAmount"
  >[],
) {
  const sum = (field: "grossAmount" | "discountAmount" | "taxAmount" | "netAmount") =>
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

export function formatSalesMoney(value: string) {
  return `Rs ${new Decimal(value).toFixed(2)}`;
}

function percent(value: string, label: string) {
  const result = parseNonNegativeDecimal(value || "0", label, 7);
  if (result.gt(100) || result.decimalPlaces() > 4)
    throw new SalesOrderDomainError(`${label} must be between 0 and 100 with up to 4 decimals.`);
  return result;
}
function boundedMoney(value: string, label: string) {
  const result = parseNonNegativeDecimal(value, label, 24);
  if (result.decimalPlaces() > 6 || result.gt("999999999999999999.999999"))
    throw new SalesOrderDomainError(`${label} is outside the supported monetary range.`);
  return result;
}
function money(value: Decimal) {
  const result = value.toDecimalPlaces(6, Decimal.ROUND_HALF_UP);
  if (result.gt("999999999999999999.999999"))
    throw new SalesOrderDomainError("Sales amount exceeds the supported monetary range.");
  return result;
}
export class SalesOrderDomainError extends Error {}
