import type { ApplicationPrincipal } from "@/modules/access/domain/principal";
import type { UnitDimension } from "@/modules/master-data/domain/master-data";
import type { PackagingUsageBasis, RecipeStatus } from "./contracts";

export const PRODUCTION_BATCH_STATUSES = [
  "DRAFT",
  "PLANNED",
  "RELEASED",
  "IN_PROGRESS",
  "COMPLETED",
  "CANCELLED",
] as const;
export type ProductionBatchStatus = (typeof PRODUCTION_BATCH_STATUSES)[number];

export type BatchWarehouseOption = {
  id: string;
  code: string;
  name: string;
  active: boolean;
};

export type BatchRecipeOption = {
  id: string;
  code: string;
  name: string;
  version: number;
  status: RecipeStatus;
  finishedGoodId: string;
  finishedGoodCode: string;
  finishedGoodName: string;
  standardBatchQuantity: string;
  standardBatchUnitId: string;
  standardBatchUnitCode: string;
  standardBatchUnitSymbol: string;
  standardBatchDimension: UnitDimension;
  expectedOutputQuantity: string | null;
  expectedOutputUnitSymbol: string | null;
  piecesPerCarton: number;
};

export type ProductionBatchInput = {
  id?: string | undefined;
  recipeId: string;
  plannedBatchQuantity: string;
  plannedBatchUnitId: string;
  plannedProductionDate: string;
  targetCompletionDate?: string | undefined;
  rawMaterialWarehouseId: string;
  packagingWarehouseId: string;
  finishedGoodsDestinationWarehouseId: string;
  plannedCartons: string;
  plannedLoosePieces: string;
  notes?: string | undefined;
  actorUserId: string;
};

export type ProductionMaterialRequirementRecord = {
  id: string;
  sequence: number;
  recipeIngredientId: string;
  itemId: string;
  itemCode: string;
  itemName: string;
  standardNormalizedQuantity: string;
  plannedNormalizedQuantity: string;
  allowancePercent: string;
  recommendedIssueQuantity: string;
  canonicalUnitId: string;
  canonicalUnitCode: string;
  canonicalUnitSymbol: string;
  canonicalUnitDimension: UnitDimension;
  availableQuantity: string;
  shortageQuantity: string;
  surplusQuantity: string;
};

export type ProductionPackagingRequirementRecord = {
  id: string;
  sequence: number;
  packagingBomLineId: string;
  itemId: string;
  itemCode: string;
  itemName: string;
  usageBasis: PackagingUsageBasis;
  standardRequiredQuantity: string;
  allowancePercent: string;
  recommendedIssueQuantity: string;
  canonicalUnitId: string;
  canonicalUnitCode: string;
  canonicalUnitSymbol: string;
  canonicalUnitDimension: UnitDimension;
  availableQuantity: string;
  shortageQuantity: string;
  surplusQuantity: string;
};

export type ProductionBatchRecord = {
  id: string;
  batchNumber: string;
  recipeId: string;
  recipeCode: string;
  recipeName: string;
  recipeVersion: number;
  finishedGoodId: string;
  finishedGoodCode: string;
  finishedGoodName: string;
  status: ProductionBatchStatus;
  plannedBatchEnteredQuantity: string;
  plannedBatchUnitId: string;
  plannedBatchUnitCode: string;
  plannedBatchUnitSymbol: string;
  plannedBatchNormalizedQuantity: string;
  plannedBatchCanonicalUnitId: string;
  plannedBatchCanonicalCode: string;
  plannedBatchCanonicalSymbol: string;
  plannedBatchDimension: UnitDimension;
  scaleFactor: string;
  plannedExpectedOutputNormalizedQuantity: string | null;
  expectedOutputCanonicalCode: string | null;
  expectedOutputCanonicalSymbol: string | null;
  expectedYieldPercent: string | null;
  plannedCartons: string;
  plannedLoosePieces: string;
  plannedTotalPieces: string;
  plannedProductContentNormalizedQuantity: string;
  productContentCanonicalCode: string;
  productContentCanonicalSymbol: string;
  expectedOutputDifferenceNormalizedQuantity: string | null;
  plannedProductionDate: Date;
  targetCompletionDate: Date | null;
  rawMaterialWarehouseId: string;
  rawMaterialWarehouseCode: string;
  rawMaterialWarehouseName: string;
  packagingWarehouseId: string;
  packagingWarehouseCode: string;
  packagingWarehouseName: string;
  finishedGoodsDestinationWarehouseId: string;
  finishedGoodsDestinationWarehouseCode: string;
  finishedGoodsDestinationWarehouseName: string;
  notes: string | null;
  createdByName: string;
  releasedByName: string | null;
  releasedAt: Date | null;
  cancelledByName: string | null;
  cancelledAt: Date | null;
  cancellationReason: string | null;
  createdAt: Date;
  updatedAt: Date;
  hasShortage: boolean;
  materialRequirements: readonly ProductionMaterialRequirementRecord[];
  packagingRequirements: readonly ProductionPackagingRequirementRecord[];
};

export type ProductionBatchSummary = Omit<
  ProductionBatchRecord,
  "materialRequirements" | "packagingRequirements"
>;
export type ProductionBatchQuery = {
  page: number;
  query: string;
  finishedGoodId?: string | undefined;
  recipeId?: string | undefined;
  status?: ProductionBatchStatus | undefined;
  date?: Date | undefined;
};
export type ProductionBatchPage = {
  records: readonly ProductionBatchSummary[];
  page: number;
  pageCount: number;
  total: number;
};
export type ProductionBatchMutationResult =
  { ok: true; id: string; hasShortage?: boolean } | { ok: false; message: string };

export interface ProductionBatchRepository {
  listApprovedRecipes(): Promise<readonly BatchRecipeOption[]>;
  listBatchUnits(): Promise<readonly import("./contracts").RecipeUnit[]>;
  listActiveWarehouses(): Promise<readonly BatchWarehouseOption[]>;
  createBatch(input: ProductionBatchInput): Promise<string>;
  updateBatch(input: ProductionBatchInput & { id: string }): Promise<string>;
  planBatch(id: string, actorUserId: string): Promise<void>;
  releaseBatch(id: string, actorUserId: string, acknowledgeShortage: boolean): Promise<boolean>;
  cancelBatch(id: string, actorUserId: string, reason: string): Promise<void>;
  getBatch(id: string): Promise<ProductionBatchRecord | null>;
  listBatches(query: ProductionBatchQuery): Promise<ProductionBatchPage>;
}

export function requireBatchManager(
  actor: ApplicationPrincipal,
): ProductionBatchMutationResult | null {
  return actor.active && actor.permissions.includes("production.manage")
    ? null
    : { ok: false, message: "Production management permission is required." };
}

export class ProductionBatchRepositoryError extends Error {
  constructor(
    readonly reason: "not-found" | "invalid-reference" | "invalid-state" | "conflict" | "shortage",
    message: string,
  ) {
    super(message);
    this.name = "ProductionBatchRepositoryError";
  }
}
