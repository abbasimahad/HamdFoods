import Decimal from "decimal.js";

import type { InventoryUnitOption } from "@/modules/inventory/application/contracts";
import { piecesToCartons } from "@/modules/quantity/domain/cartons";
import { formatQuantity } from "@/modules/quantity/domain/quantity";

export function readableInventoryQuantity(input: {
  quantity: string;
  unit: InventoryUnitOption;
  availableUnits: readonly InventoryUnitOption[];
  piecesPerCarton: number | null;
  showSign?: boolean;
}) {
  const exact = new Decimal(input.quantity);
  const sign = exact.isNegative() ? "-" : input.showSign && exact.isPositive() ? "+" : "";
  const amount = exact.abs().toFixed();
  if (input.unit.code === "PCS" && input.piecesPerCarton) {
    const breakdown = piecesToCartons(amount, input.piecesPerCarton);
    return `${sign}${amount} ${input.unit.symbol} (${breakdown.cartons} cartons + ${breakdown.loosePieces} loose)`;
  }
  return `${sign}${formatQuantity({ amount, unit: input.unit }, input.availableUnits)}`;
}
