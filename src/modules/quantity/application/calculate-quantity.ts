import { z } from "zod";

import {
  calculateCartonsAndLooseContent,
  formatCartonBreakdown,
  formatFinishedGoodContent,
} from "@/modules/quantity/domain/cartons";
import { convertQuantity, QuantityDomainError } from "@/modules/quantity/domain/quantity";

import type { QuantityCalculatorResult, QuantityCatalog } from "./contracts";

const nonNegativeDecimal = z
  .string()
  .trim()
  .max(61)
  .regex(/^(?:0|[1-9]\d*)(?:\.\d+)?$/);
const nonNegativeInteger = z
  .string()
  .trim()
  .max(30)
  .regex(/^(?:0|[1-9]\d*)$/);

const calculatorQuerySchema = z.discriminatedUnion("calculation", [
  z.object({
    calculation: z.literal("unit"),
    quantity: nonNegativeDecimal,
    fromUnitId: z.string().min(1),
    toUnitId: z.string().min(1),
  }),
  z.object({
    calculation: z.literal("carton"),
    finishedGoodId: z.string().min(1),
    cartons: nonNegativeInteger,
    loosePieces: nonNegativeInteger,
  }),
]);

export async function calculateQuantityQuery(
  input: unknown,
  catalog: QuantityCatalog,
): Promise<QuantityCalculatorResult> {
  const calculation = calculationKind(input);
  if (!calculation) return { kind: "idle" };
  const parsed = calculatorQuerySchema.safeParse(input);
  if (!parsed.success) {
    return {
      kind: "error",
      calculation,
      message: "Check the calculator inputs and use non-negative quantities.",
    };
  }

  try {
    if (parsed.data.calculation === "unit") {
      const [fromUnit, toUnit] = await Promise.all([
        catalog.getActiveUnit(parsed.data.fromUnitId),
        catalog.getActiveUnit(parsed.data.toUnitId),
      ]);
      if (!fromUnit || !toUnit) {
        return missingReference("unit", "Select active supported units.");
      }
      const converted = convertQuantity({ amount: parsed.data.quantity, unit: fromUnit }, toUnit);
      return {
        kind: "unit",
        inputText: `${parsed.data.quantity} ${fromUnit.symbol}`,
        resultText: `${converted.amount} ${toUnit.symbol}`,
      };
    }

    const [finishedGood, availableUnits] = await Promise.all([
      catalog.getActiveFinishedGood(parsed.data.finishedGoodId),
      catalog.listActiveSupportedUnits(),
    ]);
    if (!finishedGood) {
      return missingReference("carton", "Select an active finished good with a valid profile.");
    }
    const calculated = calculateCartonsAndLooseContent(
      {
        netContentQuantity: finishedGood.netContentQuantity,
        netContentUnit: finishedGood.netContentUnit,
        netContentUnitDimension: finishedGood.netContentUnitDimension,
        piecesPerCarton: finishedGood.piecesPerCarton,
      },
      parsed.data.cartons,
      parsed.data.loosePieces,
    );
    return {
      kind: "carton",
      productName: finishedGood.name,
      productDefinition: `${finishedGood.netContentQuantity} ${finishedGood.netContentUnit.symbol} × ${finishedGood.piecesPerCarton}`,
      normalizedBreakdown: formatCartonBreakdown(calculated.breakdown),
      totalPieces: calculated.breakdown.totalPieces,
      totalContent: formatFinishedGoodContent(calculated.content, availableUnits),
    };
  } catch (error) {
    return {
      kind: "error",
      calculation,
      message:
        error instanceof QuantityDomainError
          ? error.message
          : "The quantity could not be calculated.",
    };
  }
}

function calculationKind(input: unknown): "unit" | "carton" | null {
  if (!input || typeof input !== "object") return null;
  const value = (input as { calculation?: unknown }).calculation;
  return value === "unit" || value === "carton" ? value : null;
}

function missingReference(
  calculation: "unit" | "carton",
  message: string,
): QuantityCalculatorResult {
  return { kind: "error", calculation, message };
}
