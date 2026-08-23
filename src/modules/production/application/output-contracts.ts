import type { ApplicationPrincipal } from "@/modules/access/domain/principal";
import type { UnitDimension } from "@/modules/master-data/domain/master-data";
import type { BatchWarehouseOption } from "./batch-contracts";
import type { RecipeUnit } from "./contracts";
import type { MaterialMutationResult } from "./material-contracts";

export const PRODUCTION_OUTPUT_TYPES = ["GOOD", "REPROCESS", "REJECTED", "PROCESS_LOSS"] as const;
export type ProductionOutputType = (typeof PRODUCTION_OUTPUT_TYPES)[number];
export const PRODUCTION_LOSS_REASONS = [
  "NORMAL_PROCESS_LOSS",
  "EVAPORATION",
  "SPILLAGE",
  "SAMPLING",
  "EQUIPMENT_RETAINED",
  "ABNORMAL_LOSS",
  "OTHER",
] as const;
export type ProductionLossReason = (typeof PRODUCTION_LOSS_REASONS)[number];
export const PRODUCTION_LOSS_NATURES = ["NORMAL", "ABNORMAL"] as const;
export type ProductionLossNature = (typeof PRODUCTION_LOSS_NATURES)[number];

export type OutputTransactionInput = {
  id?: string | undefined;
  productionBatchId: string;
  outputType: ProductionOutputType;
  transactionDate: string;
  cartons?: string | undefined;
  loosePieces?: string | undefined;
  quantity?: string | undefined;
  unitId?: string | undefined;
  productionDate: string;
  expiryDate?: string | undefined;
  destinationWarehouseId: string;
  lossReason?: ProductionLossReason | undefined;
  lossNature?: ProductionLossNature | undefined;
  notes?: string | undefined;
  actorUserId: string;
};

export type OutputTransactionRecord = {
  id: string;
  outputNumber: string;
  productionBatchId: string;
  outputType: ProductionOutputType;
  transactionDate: Date;
  status: "DRAFT" | "POSTED" | "CANCELLED";
  cartons: string | null;
  loosePieces: string | null;
  totalPieces: string | null;
  enteredQuantity: string | null;
  enteredUnitId: string | null;
  enteredUnitSymbol: string | null;
  normalizedQuantity: string | null;
  canonicalUnitId: string | null;
  canonicalUnitSymbol: string | null;
  canonicalUnitDimension: UnitDimension | null;
  productionDate: Date;
  expiryDate: Date | null;
  destinationWarehouseId: string;
  destinationWarehouseName: string;
  productionLotId: string | null;
  productionLotNumber: string | null;
  lossReason: ProductionLossReason | null;
  lossNature: ProductionLossNature | null;
  notes: string | null;
  createdByName: string;
  postedByName: string | null;
  postedAt: Date | null;
};

export type FinalPackagingVariance = {
  requirementId: string;
  itemCode: string;
  itemName: string;
  usageBasis: "PER_PIECE" | "PER_CARTON";
  plannedStandard: string;
  finalStandard: string;
  recommendedIssue: string;
  goodConsumed: string;
  damaged: string;
  returned: string;
  totalDepleted: string;
  plannedVariance: string;
  finalVariance: string;
  goodConsumptionVariance: string;
  consistencyWarning: string | null;
  unitSymbol: string;
};

export type ProductionOutputView = {
  productionBatchId: string;
  batchNumber: string;
  batchStatus: string;
  recipeCode: string;
  recipeVersion: number;
  finishedGoodCode: string;
  finishedGoodName: string;
  piecesPerCarton: number;
  destinationWarehouseId: string;
  destinationWarehouseName: string;
  productContentUnitId: string;
  productContentUnitSymbol: string;
  productContentDimension: UnitDimension;
  expectedYieldPercent: string | null;
  plannedBatch: string;
  plannedFinishedOutput: string;
  plannedExpectedOutput: string | null;
  goodCartons: string;
  goodLoosePieces: string;
  goodTotalPieces: string;
  goodContent: string;
  reprocessOutput: string;
  rejectedOutput: string;
  processLoss: string;
  rawMaterials: readonly {
    requirementId: string;
    itemCode: string;
    itemName: string;
    planned: string;
    issued: string;
    returned: string;
    consumed: string;
    variance: string;
    varianceDirection: "OVER" | "UNDER" | "EXACT";
    unitSymbol: string;
  }[];
  inputComponents: readonly { dimension: UnitDimension; quantity: string; unitSymbol: string }[];
  reconciliation: {
    compatible: boolean;
    actualInput: string | null;
    totalAccountedOutput: string;
    unreconciledDifference: string | null;
    goodYieldPercent: string | null;
    recoverableYieldPercent: string | null;
    processLossPercent: string | null;
    expectedYieldDifferencePoints: string | null;
  };
  packaging: readonly FinalPackagingVariance[];
  productionLot: {
    id: string;
    lotNumber: string;
    productionDate: Date;
    expiryDate: Date | null;
  } | null;
  consumedSupplierLots: readonly {
    itemCode: string;
    itemName: string;
    supplierName: string;
    supplierLotNumber: string | null;
    goodsReceiptNumber: string;
    consumedQuantity: string;
    unitSymbol: string;
  }[];
  transactions: readonly OutputTransactionRecord[];
  completionBlockers: readonly string[];
  completionNeedsExplanation: boolean;
  completionExplanation: string | null;
  completedByName: string | null;
  completedAt: Date | null;
};

export interface ProductionOutputRepository {
  listUnits(): Promise<readonly RecipeUnit[]>;
  listWarehouses(): Promise<readonly BatchWarehouseOption[]>;
  getOutputView(batchId: string): Promise<ProductionOutputView | null>;
  getTransaction(id: string): Promise<OutputTransactionRecord | null>;
  createTransaction(input: OutputTransactionInput): Promise<string>;
  updateTransaction(input: OutputTransactionInput & { id: string }): Promise<string>;
  postTransaction(id: string, actorUserId: string): Promise<void>;
  cancelTransaction(id: string, actorUserId: string, reason: string): Promise<void>;
  completeBatch(batchId: string, actorUserId: string, explanation?: string): Promise<void>;
}

export function requireOutputManager(actor: ApplicationPrincipal): MaterialMutationResult | null {
  return actor.active && actor.permissions.includes("production.manage")
    ? null
    : { ok: false, message: "Production management permission is required." };
}

export class ProductionOutputRepositoryError extends Error {
  constructor(
    readonly reason: "invalid-reference" | "invalid-state" | "conflict" | "reconciliation",
    message: string,
  ) {
    super(message);
    this.name = "ProductionOutputRepositoryError";
  }
}
