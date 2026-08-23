import type { ApplicationPrincipal } from "@/modules/access/domain/principal";
import type { UnitDimension } from "@/modules/master-data/domain/master-data";
import type { BatchWarehouseOption } from "./batch-contracts";
import type { RecipeUnit } from "./contracts";

export const MATERIAL_TRANSACTION_TYPES = ["ISSUE", "RETURN", "CONSUMPTION"] as const;
export type MaterialTransactionType = (typeof MATERIAL_TRANSACTION_TYPES)[number];
export const MATERIAL_TRANSACTION_STATUSES = ["DRAFT", "POSTED", "CANCELLED"] as const;
export type MaterialTransactionStatus = (typeof MATERIAL_TRANSACTION_STATUSES)[number];

export type MaterialTransactionInput = {
  id?: string | undefined;
  productionBatchId: string;
  transactionType: MaterialTransactionType;
  transactionDate: string;
  batchRequirementId: string;
  inventoryLotId: string;
  quantity: string;
  unitId: string;
  destinationWarehouseId?: string | undefined;
  notes?: string | undefined;
  actorUserId: string;
};

export type EligibleMaterialLot = {
  id: string;
  itemId: string;
  itemCode: string;
  itemName: string;
  warehouseId: string;
  supplierName: string;
  supplierLotNumber: string | null;
  goodsReceiptNumber: string;
  manufacturingDate: Date | null;
  expiryDate: Date | null;
  availableQuantity: string;
  canonicalUnitId: string;
  canonicalUnitCode: string;
  canonicalUnitSymbol: string;
  canonicalUnitDimension: UnitDimension;
};

export type MaterialRequirementReconciliation = {
  requirementId: string;
  itemId: string;
  itemCode: string;
  itemName: string;
  plannedQuantity: string;
  allowancePercent: string;
  recommendedIssueQuantity: string;
  availableQuantity: string;
  cumulativeIssued: string;
  remainingPlannedQuantity: string;
  cumulativeReturned: string;
  cumulativeConsumed: string;
  currentlyInProduction: string;
  varianceQuantity: string;
  varianceDirection: "OVER" | "UNDER" | "EXACT";
  canonicalUnitId: string;
  canonicalUnitCode: string;
  canonicalUnitSymbol: string;
  canonicalUnitDimension: UnitDimension;
};

export type MaterialTransactionRecord = {
  id: string;
  transactionNumber: string;
  productionBatchId: string;
  batchNumber: string;
  transactionType: MaterialTransactionType;
  transactionDate: Date;
  status: MaterialTransactionStatus;
  notes: string | null;
  createdByName: string;
  postedByName: string | null;
  postedAt: Date | null;
  cancelledByName: string | null;
  cancelledAt: Date | null;
  cancellationReason: string | null;
  createdAt: Date;
  line: {
    id: string;
    batchRequirementId: string;
    itemId: string;
    itemCode: string;
    itemName: string;
    sourceWarehouseId: string;
    sourceWarehouseName: string;
    destinationWarehouseId: string | null;
    destinationWarehouseName: string | null;
    inventoryLotId: string;
    supplierLotNumber: string | null;
    goodsReceiptNumber: string;
    enteredQuantity: string;
    enteredUnitId: string;
    enteredUnitCode: string;
    enteredUnitSymbol: string;
    normalizedQuantity: string;
    canonicalUnitId: string;
    canonicalUnitCode: string;
    canonicalUnitSymbol: string;
    canonicalUnitDimension: UnitDimension;
    notes: string | null;
  };
};

export type BatchMaterialView = {
  productionBatchId: string;
  batchNumber: string;
  batchStatus: string;
  finishedGoodCode: string;
  finishedGoodName: string;
  rawMaterialWarehouseId: string;
  rawMaterialWarehouseName: string;
  requirements: readonly MaterialRequirementReconciliation[];
  availableLots: readonly EligibleMaterialLot[];
  heldLots: readonly EligibleMaterialLot[];
  transactions: readonly MaterialTransactionRecord[];
};

export type MaterialMutationResult = { ok: true; id: string } | { ok: false; message: string };

export interface ProductionMaterialRepository {
  listUnits(): Promise<readonly RecipeUnit[]>;
  listWarehouses(): Promise<readonly BatchWarehouseOption[]>;
  getBatchMaterialView(productionBatchId: string): Promise<BatchMaterialView | null>;
  getTransaction(id: string): Promise<MaterialTransactionRecord | null>;
  createTransaction(input: MaterialTransactionInput): Promise<string>;
  updateTransaction(input: MaterialTransactionInput & { id: string }): Promise<string>;
  postTransaction(id: string, actorUserId: string): Promise<void>;
  cancelTransaction(id: string, actorUserId: string, reason: string): Promise<void>;
}

export function requireProductionMaterialManager(
  actor: ApplicationPrincipal,
): MaterialMutationResult | null {
  return actor.active && actor.permissions.includes("production.manage")
    ? null
    : { ok: false, message: "Production management permission is required." };
}

export class ProductionMaterialRepositoryError extends Error {
  constructor(
    readonly reason: "not-found" | "invalid-reference" | "invalid-state" | "stock" | "conflict",
    message: string,
  ) {
    super(message);
    this.name = "ProductionMaterialRepositoryError";
  }
}
