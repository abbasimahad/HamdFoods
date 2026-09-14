import Decimal from "decimal.js";

import { validateReprocessEligibility } from "@/modules/production/domain/reprocess";

export type WasteDispositionAction = "MOVE_TO_SCRAP" | "MOVE_TO_REPROCESS" | "WRITE_OFF";
export type WasteDispositionSourceStatus = "DAMAGED" | "QUARANTINE" | "SCRAP";
export type WasteDispositionReason =
  | "DAMAGED"
  | "EXPIRED"
  | "SPOILED"
  | "CONTAMINATED"
  | "PACKAGING_DAMAGE"
  | "PRODUCTION_LOSS"
  | "QUALITY_REJECT"
  | "HANDLING_DAMAGE"
  | "OTHER";

export class WasteDispositionDomainError extends Error {
  constructor(
    readonly code: "ACTION_STATUS" | "QUANTITY" | "LOT" | "REASON",
    message: string,
  ) {
    super(message);
    this.name = "WasteDispositionDomainError";
  }
}

export function validateWasteDispositionLine(input: {
  itemType: string;
  sourceStatus: string;
  action: string;
  reason: string;
  notes?: string | undefined;
  quantity: string;
  eligibleQuantity: string;
  inventoryLotId: string | null;
  productionLotId: string | null;
  sourceExpiry: Date | null;
  reprocessShelfLifeDays: number | null;
  today: Date;
}) {
  const destinationStatus = destination(input.action, input.sourceStatus);
  if ((input.inventoryLotId === null) === (input.productionLotId === null))
    throw new WasteDispositionDomainError("LOT", "Select exactly one lot provenance.");
  const quantity = decimal(input.quantity);
  const eligible = decimal(input.eligibleQuantity);
  if (!quantity || quantity.lte(0))
    throw new WasteDispositionDomainError(
      "QUANTITY",
      "Disposition quantity must be greater than zero.",
    );
  if (!eligible || quantity.gt(eligible))
    throw new WasteDispositionDomainError(
      "QUANTITY",
      "Disposition quantity exceeds the selected lot/status balance.",
    );
  if (input.reason === "OTHER" && !input.notes?.trim())
    throw new WasteDispositionDomainError("REASON", "Notes are required for reason OTHER.");
  if (input.action === "MOVE_TO_REPROCESS")
    validateReprocessEligibility({
      itemType: input.itemType,
      sourceStatus: input.sourceStatus,
      allowedSourceStatuses: ["DAMAGED", "QUARANTINE"],
      requestedQuantity: quantity.toFixed(),
      eligibleQuantity: eligible.toFixed(),
      sourceExpiry: input.sourceExpiry,
      reprocessShelfLifeDays: input.reprocessShelfLifeDays,
      today: input.today,
    });
  return { destinationStatus, quantity: quantity.toFixed() };
}

export function validateWasteReversal(input: {
  action: WasteDispositionAction;
  quantity: string;
  destinationBalance: string;
  downstreamReprocessClaims: number;
  downstreamDispositionClaims?: number | undefined;
  originalValue?: string | null | undefined;
  originalUnitCost?: string | null | undefined;
}) {
  const quantity = decimal(input.quantity);
  const balance = decimal(input.destinationBalance);
  if (!quantity || quantity.lte(0))
    throw new WasteDispositionDomainError("QUANTITY", "Reversal quantity must be positive.");
  if (input.action === "MOVE_TO_REPROCESS" && input.downstreamReprocessClaims > 0)
    throw new WasteDispositionDomainError(
      "ACTION_STATUS",
      "REPROCESS custody has already been claimed by Reprocess and cannot be reversed.",
    );
  if (input.action !== "WRITE_OFF" && (input.downstreamDispositionClaims ?? 0) > 0)
    throw new WasteDispositionDomainError(
      "ACTION_STATUS",
      "Destination custody has later disposition activity and cannot be reversed.",
    );
  if (input.action !== "WRITE_OFF" && (!balance || !balance.eq(quantity)))
    throw new WasteDispositionDomainError(
      "QUANTITY",
      "Reversal requires the exact original quantity to remain in destination custody.",
    );
  if (input.action === "WRITE_OFF") {
    const value = input.originalValue === null ? null : decimal(input.originalValue ?? "");
    const unitCost = input.originalUnitCost === null ? null : decimal(input.originalUnitCost ?? "");
    if (!value || value.lt(0) || !unitCost || unitCost.lt(0))
      throw new WasteDispositionDomainError(
        "QUANTITY",
        "Write-off reversal requires frozen original value and unit cost.",
      );
    return {
      quantity: quantity.toFixed(),
      originalValue: value.toDecimalPlaces(6).toFixed(6),
      originalUnitCost: unitCost.toDecimalPlaces(12).toFixed(12),
    };
  }
  return { quantity: quantity.toFixed() };
}

function destination(action: string, sourceStatus: string) {
  if (action === "MOVE_TO_SCRAP" && (sourceStatus === "DAMAGED" || sourceStatus === "QUARANTINE"))
    return "SCRAP" as const;
  if (
    action === "MOVE_TO_REPROCESS" &&
    (sourceStatus === "DAMAGED" || sourceStatus === "QUARANTINE")
  )
    return "REPROCESS" as const;
  if (action === "WRITE_OFF" && (sourceStatus === "DAMAGED" || sourceStatus === "SCRAP"))
    return null;
  throw new WasteDispositionDomainError(
    "ACTION_STATUS",
    `${action} is not allowed from ${sourceStatus}.`,
  );
}

function decimal(value: string) {
  try {
    const result = new Decimal(value);
    return result.isFinite() ? result : null;
  } catch {
    return null;
  }
}
