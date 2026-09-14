import Decimal from "decimal.js";

export type ReprocessEligibilityInput = {
  itemType: string;
  sourceStatus: string;
  requestedQuantity: string;
  eligibleQuantity: string;
  sourceExpiry: Date | null;
  reprocessShelfLifeDays: number | null;
  today: Date;
  allowedSourceStatuses?: readonly string[];
};

export type ReprocessEligibilitySnapshot = {
  requestedQuantity: string;
  sourceExpirySnapshot: Date;
  shelfLifeDaysSnapshot: number;
};

export class ReprocessDomainError extends Error {
  constructor(
    readonly code:
      | "ITEM_TYPE"
      | "SOURCE_STATUS"
      | "QUANTITY"
      | "INSUFFICIENT_QUANTITY"
      | "SHELF_LIFE_POLICY"
      | "SOURCE_EXPIRY"
      | "SOURCE_EXPIRED"
      | "QC_AUTHORITY",
    message: string,
  ) {
    super(message);
    this.name = "ReprocessDomainError";
  }
}

export function validateReprocessEligibility(
  input: ReprocessEligibilityInput,
): ReprocessEligibilitySnapshot {
  if (input.itemType !== "FINISHED_GOOD")
    throw new ReprocessDomainError(
      "ITEM_TYPE",
      "Only finished goods can enter the Reprocess workflow.",
    );
  if (!(input.allowedSourceStatuses ?? ["REPROCESS"]).includes(input.sourceStatus))
    throw new ReprocessDomainError(
      "SOURCE_STATUS",
      "The source lot must already be held in REPROCESS custody.",
    );
  const requested = decimal(input.requestedQuantity);
  const eligible = decimal(input.eligibleQuantity);
  if (!requested || requested.lte(0))
    throw new ReprocessDomainError("QUANTITY", "Reprocess quantity must be greater than zero.");
  if (!eligible || requested.gt(eligible))
    throw new ReprocessDomainError(
      "INSUFFICIENT_QUANTITY",
      "Reprocess quantity exceeds the selected lot's eligible custody.",
    );
  if (
    !Number.isSafeInteger(input.reprocessShelfLifeDays) ||
    input.reprocessShelfLifeDays === null ||
    input.reprocessShelfLifeDays <= 0 ||
    input.reprocessShelfLifeDays > 3650
  )
    throw new ReprocessDomainError(
      "SHELF_LIFE_POLICY",
      "Configure the finished good's reprocess shelf-life policy before starting reprocess.",
    );
  if (!input.sourceExpiry || Number.isNaN(input.sourceExpiry.getTime()))
    throw new ReprocessDomainError(
      "SOURCE_EXPIRY",
      "The source production lot must have an authoritative expiry date.",
    );
  if (dateOnly(input.sourceExpiry) < dateOnly(input.today))
    throw new ReprocessDomainError(
      "SOURCE_EXPIRED",
      "Expired finished goods are not eligible for reprocess.",
    );
  return {
    requestedQuantity: requested.toFixed(),
    sourceExpirySnapshot: new Date(input.sourceExpiry.getTime()),
    shelfLifeDaysSnapshot: input.reprocessShelfLifeDays,
  };
}

export function calculateReprocessChildExpiry(
  completionDate: Date,
  shelfLifeDays: number,
  sourceExpiry: Date,
) {
  if (
    Number.isNaN(completionDate.getTime()) ||
    Number.isNaN(sourceExpiry.getTime()) ||
    !Number.isSafeInteger(shelfLifeDays) ||
    shelfLifeDays <= 0 ||
    shelfLifeDays > 3650
  )
    throw new ReprocessDomainError(
      "SHELF_LIFE_POLICY",
      "Reprocess expiry requires valid frozen completion, source-expiry, and policy values.",
    );
  const policyExpiry = new Date(completionDate.getTime());
  policyExpiry.setUTCDate(policyExpiry.getUTCDate() + shelfLifeDays);
  return new Date(Math.min(dateOnly(policyExpiry), dateOnly(sourceExpiry)));
}

export function reconcileReprocessYield(input: {
  source: string;
  good: string;
  scrap: string;
  processLoss: string;
}) {
  const source = decimal(input.source);
  const good = decimal(input.good);
  const scrap = decimal(input.scrap);
  const processLoss = decimal(input.processLoss);
  if (!source || !good || !scrap || !processLoss || source.lte(0) || good.lte(0))
    throw new ReprocessDomainError(
      "QUANTITY",
      "Reprocess completion quantities must be valid and GOOD output must be positive.",
    );
  const accounted = good.add(scrap).add(processLoss);
  if (!accounted.eq(source))
    throw new ReprocessDomainError(
      "QUANTITY",
      "GOOD output plus scrap and documented process loss must exactly equal source content.",
    );
  return { source: source.toFixed(), accounted: accounted.toFixed() };
}

export function validateReprocessQualityAuthority(
  inspectorUserId: string,
  initiatedByUserId: string,
  completedByUserId: string,
) {
  if (inspectorUserId === initiatedByUserId || inspectorUserId === completedByUserId)
    throw new ReprocessDomainError(
      "QC_AUTHORITY",
      "Another authorized quality user must review this reprocess result.",
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

function dateOnly(value: Date) {
  return Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate());
}
