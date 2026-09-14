import type { ProductionBatchInput } from "./batch-contracts";

export type ReprocessDraftInput = Omit<ProductionBatchInput, "id"> & {
  sourceProductionLotId: string;
  sourceWarehouseId: string;
  sourceQuantity: string;
  sourceUnitId: string;
  reason: string;
};

export type ReprocessMutationResult = { ok: true; id: string } | { ok: false; message: string };

export interface ReprocessRepository {
  createDraft(input: ReprocessDraftInput): Promise<string>;
  updateDraftMetadata(input: ReprocessDraftMetadataInput): Promise<void>;
  reserve(id: string, actorUserId: string): Promise<void>;
  start(id: string, actorUserId: string): Promise<void>;
  cancel(id: string, actorUserId: string, reason: string): Promise<void>;
  decideQuality(input: ReprocessQualityDecisionInput): Promise<void>;
}

export type ReprocessDraftMetadataInput = {
  id: string;
  reason: string;
  notes?: string | undefined;
  actorUserId: string;
};

export type ReprocessQualityDecisionInput = {
  id: string;
  decision: "APPROVED" | "REJECTED";
  rejectionReason?:
    | "DAMAGED"
    | "EXPIRED"
    | "SPOILED"
    | "CONTAMINATED"
    | "PACKAGING_DAMAGE"
    | "PRODUCTION_LOSS"
    | "QUALITY_REJECT"
    | "HANDLING_DAMAGE"
    | "OTHER"
    | undefined;
  notes?: string | undefined;
  actorUserId: string;
};

export class ReprocessRepositoryError extends Error {
  constructor(
    readonly reason: "not-found" | "invalid-reference" | "invalid-state" | "conflict" | "stock",
    message: string,
  ) {
    super(message);
    this.name = "ReprocessRepositoryError";
  }
}
