import type { ApplicationPrincipal } from "@/modules/access/domain/principal";
import type { UnitDimension } from "@/modules/master-data/domain/master-data";
import type { BatchWarehouseOption } from "./batch-contracts";
import type { PackagingUsageBasis, RecipeUnit } from "./contracts";
import type { EligibleMaterialLot, MaterialMutationResult } from "./material-contracts";

export const PACKAGING_TRANSACTION_TYPES = ["ISSUE", "RETURN", "CONSUMPTION", "DAMAGE"] as const;
export type PackagingTransactionType = (typeof PACKAGING_TRANSACTION_TYPES)[number];
export const PACKAGING_DAMAGE_REASONS = [
  "BROKEN",
  "CRUSHED",
  "TORN",
  "MACHINE_SETUP",
  "PRINT_DEFECT",
  "FILLING_DAMAGE",
  "HANDLING_DAMAGE",
  "OTHER",
] as const;
export type PackagingDamageReason = (typeof PACKAGING_DAMAGE_REASONS)[number];

export type PackagingTransactionInput = {
  id?: string | undefined;
  productionBatchId: string;
  transactionType: PackagingTransactionType;
  transactionDate: string;
  packagingRequirementId: string;
  inventoryLotId: string;
  quantity: string;
  unitId: string;
  destinationWarehouseId?: string | undefined;
  damageReason?: PackagingDamageReason | undefined;
  notes?: string | undefined;
  actorUserId: string;
};

export type PackagingRequirementReconciliation = {
  requirementId: string;
  itemId: string;
  itemCode: string;
  itemName: string;
  usageBasis: PackagingUsageBasis;
  standardRequiredQuantity: string;
  allowancePercent: string;
  recommendedIssueQuantity: string;
  availableQuantity: string;
  cumulativeIssued: string;
  remainingPlannedQuantity: string;
  cumulativeReturned: string;
  cumulativeGoodConsumed: string;
  cumulativeDamaged: string;
  currentlyInProduction: string;
  totalDepleted: string;
  provisionalVarianceQuantity: string;
  provisionalVarianceDirection: "OVER" | "UNDER" | "EXACT";
  goodConsumptionVarianceQuantity: string;
  goodConsumptionVarianceDirection: "OVER" | "UNDER" | "EXACT";
  canonicalUnitId: string;
  canonicalUnitCode: string;
  canonicalUnitSymbol: string;
  canonicalUnitDimension: UnitDimension;
};

export type PackagingTransactionRecord = {
  id: string;
  transactionNumber: string;
  productionBatchId: string;
  transactionType: PackagingTransactionType;
  transactionDate: Date;
  status: "DRAFT" | "POSTED" | "CANCELLED";
  damageReason: PackagingDamageReason | null;
  notes: string | null;
  createdByName: string;
  postedByName: string | null;
  postedAt: Date | null;
  line: {
    id: string;
    packagingRequirementId: string;
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
    enteredUnitSymbol: string;
    normalizedQuantity: string;
    canonicalUnitId: string;
    canonicalUnitSymbol: string;
    canonicalUnitDimension: UnitDimension;
  };
};

export type BatchPackagingView = {
  productionBatchId: string;
  batchNumber: string;
  batchStatus: string;
  finishedGoodCode: string;
  finishedGoodName: string;
  packagingWarehouseId: string;
  packagingWarehouseName: string;
  requirements: readonly PackagingRequirementReconciliation[];
  availableLots: readonly EligibleMaterialLot[];
  heldLots: readonly EligibleMaterialLot[];
  transactions: readonly PackagingTransactionRecord[];
};

export interface ProductionPackagingRepository {
  listUnits(): Promise<readonly RecipeUnit[]>;
  listWarehouses(): Promise<readonly BatchWarehouseOption[]>;
  getBatchPackagingView(id: string): Promise<BatchPackagingView | null>;
  getTransaction(id: string): Promise<PackagingTransactionRecord | null>;
  createTransaction(input: PackagingTransactionInput): Promise<string>;
  updateTransaction(input: PackagingTransactionInput & { id: string }): Promise<string>;
  postTransaction(id: string, actorUserId: string): Promise<void>;
  cancelTransaction(id: string, actorUserId: string, reason: string): Promise<void>;
}

export function requirePackagingManager(
  actor: ApplicationPrincipal,
): MaterialMutationResult | null {
  return actor.active && actor.permissions.includes("production.manage")
    ? null
    : { ok: false, message: "Production management permission is required." };
}

export class ProductionPackagingRepositoryError extends Error {
  constructor(
    readonly reason: "invalid-reference" | "invalid-state" | "stock" | "conflict",
    message: string,
  ) {
    super(message);
    this.name = "ProductionPackagingRepositoryError";
  }
}
