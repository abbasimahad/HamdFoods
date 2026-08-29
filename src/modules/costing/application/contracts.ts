import type { ApplicationPrincipal } from "@/modules/access/domain/principal";
import type {
  BatchCostingStatus,
  ItemType,
  LandedCostAllocationMethod,
  ProductionCostCategory,
} from "@/generated/prisma/client";

export type ValuationSummary = {
  itemId: string;
  itemCode: string;
  itemName: string;
  itemType: ItemType;
  categoryName: string;
  active: boolean;
  canonicalUnitSymbol: string;
  canonicalQuantity: string;
  averageUnitCost: string | null;
  inventoryValue: string;
  missingBasisCount: number;
  lastValuationAt: Date | null;
  piecesPerCarton: number | null;
};
export type ValuationHistoryEntry = {
  id: string;
  effectiveAt: Date;
  entryType: string;
  state: string;
  sourceType: string;
  sourceNumber: string | null;
  quantityEffect: string;
  unitCost: string | null;
  valueDelta: string | null;
  runningOwnedQuantity: string;
  runningInventoryValue: string;
  resultingAverageUnitCost: string | null;
  notes: string | null;
  createdByName: string;
};
export type ValuationIssueRecord = {
  id: string;
  itemId: string;
  itemCode: string;
  itemName: string;
  quantity: string;
  reasonCode: string;
  description: string;
  detectedAt: Date;
};
export type ValuationQuery = {
  query: string;
  itemType?: ItemType | undefined;
  categoryId?: string | undefined;
  active?: boolean | undefined;
  missingOnly?: boolean | undefined;
};
export type LandedCostInput = {
  goodsReceiptId: string;
  allocationMethod: LandedCostAllocationMethod;
  category: string;
  totalAmount: string;
  description: string;
  reference?: string | undefined;
  allocations: readonly { goodsReceiptLineId: string; allocatedAmount: string }[];
  actorUserId: string;
};
export type ProductionCostEntryInput = {
  productionBatchId: string;
  category: ProductionCostCategory;
  amount: string;
  description: string;
  reference?: string | undefined;
  actorUserId: string;
};
export type BatchCostLine = {
  itemCode: string;
  itemName: string;
  quantity: string;
  unitCost: string | null;
  totalCost: string | null;
  plannedQuantity: string | null;
};
export type BatchCostingRecord = {
  batchId: string;
  batchNumber: string;
  batchStatus: string;
  costingStatus: BatchCostingStatus;
  finishedGoodCode: string;
  finishedGoodName: string;
  piecesPerCarton: number;
  rawMaterials: readonly BatchCostLine[];
  packaging: readonly BatchCostLine[];
  damagedPackaging: readonly BatchCostLine[];
  manualEntries: readonly {
    id: string;
    category: ProductionCostCategory;
    amount: string;
    description: string;
    reference: string | null;
    createdByName: string;
  }[];
  rawMaterialCost: string | null;
  packagingCost: string | null;
  additionalCost: string;
  costCredits: string;
  damagedPackagingExposure: string | null;
  finishedGoodsCostPool: string | null;
  actualGoodPieces: string;
  costPerPiece: string | null;
  costPerCarton: string | null;
  abnormalLossQuantity: string;
  warnings: readonly string[];
  finalizedAt: Date | null;
  finalizedByName: string | null;
};
export interface InventoryValuationRepository {
  listValuationReferences(): Promise<{ categories: readonly { id: string; name: string }[] }>;
  listValuation(query: ValuationQuery): Promise<readonly ValuationSummary[]>;
  getItemHistory(
    itemId: string,
  ): Promise<{ summary: ValuationSummary; history: readonly ValuationHistoryEntry[] } | null>;
  listUnresolvedIssues(): Promise<readonly ValuationIssueRecord[]>;
  initializeIssue(
    issueId: string,
    totalValue: string,
    reason: string,
    reference: string | undefined,
    actorUserId: string,
  ): Promise<string>;
  adjustItemValue(
    itemId: string,
    valueDelta: string,
    reason: string,
    reference: string | undefined,
    actorUserId: string,
  ): Promise<string>;
  rebuild(actorUserId: string): Promise<{ processed: number; unresolved: number }>;
  listPostedGoodsReceipts(): Promise<
    readonly {
      id: string;
      number: string;
      supplierName: string;
      lines: readonly {
        id: string;
        itemCode: string;
        itemName: string;
        quantity: string;
        baseValue: string;
      }[];
    }[]
  >;
  createAndPostLandedCost(input: LandedCostInput): Promise<string>;
  getBatchCosting(batchId: string): Promise<BatchCostingRecord | null>;
  addProductionCostEntry(input: ProductionCostEntryInput): Promise<string>;
  finalizeBatchCost(batchId: string, actorUserId: string): Promise<void>;
}
export type CostingMutationResult =
  { ok: true; id?: string; message?: string } | { ok: false; message: string };
export function requireInventoryCostManager(actor: ApplicationPrincipal) {
  return actor.active && actor.permissions.includes("inventory.manage")
    ? null
    : ({ ok: false, message: "Inventory management permission is required." } as const);
}
export function requireProductionCostManager(actor: ApplicationPrincipal) {
  return actor.active && actor.permissions.includes("production.manage")
    ? null
    : ({ ok: false, message: "Production management permission is required." } as const);
}
export class CostingRepositoryError extends Error {}
