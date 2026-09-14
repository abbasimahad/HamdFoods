import type {
  WasteDispositionAction,
  WasteDispositionReason,
  WasteDispositionSourceStatus,
} from "../domain/waste-disposition";

export type WasteDispositionLineInput = {
  itemId: string;
  inventoryLotId?: string | undefined;
  productionLotId?: string | undefined;
  sourceStatus: WasteDispositionSourceStatus;
  quantity: string;
  unitId: string;
  action: WasteDispositionAction;
  reason: WasteDispositionReason;
  notes?: string | undefined;
};

export type WasteDispositionDraftInput = {
  id?: string | undefined;
  dispositionDate: string;
  warehouseId: string;
  notes?: string | undefined;
  lines: readonly WasteDispositionLineInput[];
  actorUserId: string;
};

export type WasteDispositionMutationResult =
  { ok: true; id: string } | { ok: false; message: string };

export interface WasteDispositionRepository {
  saveDraft(input: WasteDispositionDraftInput): Promise<string>;
  post(id: string, actorUserId: string): Promise<void>;
  cancel(id: string, actorUserId: string, reason: string): Promise<void>;
  reverse(id: string, actorUserId: string, reason: string): Promise<string>;
}

export class WasteDispositionRepositoryError extends Error {
  constructor(
    readonly reason: "not-found" | "invalid-reference" | "invalid-state" | "conflict" | "stock",
    message: string,
  ) {
    super(message);
    this.name = "WasteDispositionRepositoryError";
  }
}
