import type { ApplicationPrincipal } from "@/modules/access/domain/principal";
import type { UnitDimension } from "@/modules/master-data/domain/master-data";

export const RECIPE_STATUSES = ["DRAFT", "APPROVED", "INACTIVE"] as const;
export type RecipeStatus = (typeof RECIPE_STATUSES)[number];
export const PACKAGING_USAGE_BASES = ["PER_PIECE", "PER_CARTON"] as const;
export type PackagingUsageBasis = (typeof PACKAGING_USAGE_BASES)[number];

export type RecipeUnit = {
  id: string;
  code: string;
  name: string;
  symbol: string;
  dimension: UnitDimension;
  active: boolean;
};
export type RecipeItemOption = {
  id: string;
  code: string;
  name: string;
  itemType: "RAW_MATERIAL" | "PACKAGING_MATERIAL" | "FINISHED_GOOD";
  stockUnitId: string;
  stockUnitCode: string;
  stockUnitSymbol: string;
  stockUnitDimension: UnitDimension;
  active: boolean;
  piecesPerCarton: number | null;
};
export type RecipeIngredientInput = {
  itemId: string;
  quantity: string;
  unitId: string;
  allowancePercent: string;
  processNotes?: string | undefined;
};
export type PackagingBomLineInput = {
  itemId: string;
  usageBasis: PackagingUsageBasis;
  quantity: string;
  unitId: string;
  allowancePercent: string;
  notes?: string | undefined;
};
export type RecipeInput = {
  id?: string | undefined;
  code: string;
  name: string;
  finishedGoodId: string;
  standardBatchQuantity: string;
  standardBatchUnitId: string;
  expectedOutputQuantity?: string | undefined;
  expectedOutputUnitId?: string | undefined;
  effectiveDate?: string | undefined;
  notes?: string | undefined;
  ingredients: readonly RecipeIngredientInput[];
  packagingLines: readonly PackagingBomLineInput[];
  actorUserId: string;
};
export type RecipeIngredientRecord = {
  id: string;
  sequence: number;
  itemId: string;
  itemCode: string;
  itemName: string;
  enteredQuantity: string;
  enteredUnitId: string;
  enteredUnitCode: string;
  enteredUnitSymbol: string;
  normalizedQuantity: string;
  canonicalUnitId: string;
  canonicalUnitCode: string;
  canonicalUnitSymbol: string;
  canonicalUnitDimension: UnitDimension;
  allowancePercent: string;
  processNotes: string | null;
};
export type PackagingBomLineRecord = {
  id: string;
  sequence: number;
  itemId: string;
  itemCode: string;
  itemName: string;
  usageBasis: PackagingUsageBasis;
  enteredQuantity: string;
  enteredUnitId: string;
  enteredUnitCode: string;
  enteredUnitSymbol: string;
  normalizedQuantity: string;
  canonicalUnitId: string;
  canonicalUnitCode: string;
  canonicalUnitSymbol: string;
  canonicalUnitDimension: UnitDimension;
  allowancePercent: string;
  notes: string | null;
};
export type RecipeRecord = {
  id: string;
  code: string;
  name: string;
  finishedGoodId: string;
  finishedGoodCode: string;
  finishedGoodName: string;
  piecesPerCarton: number;
  version: number;
  status: RecipeStatus;
  standardBatchEnteredQuantity: string;
  standardBatchUnitId: string;
  standardBatchUnitCode: string;
  standardBatchUnitSymbol: string;
  standardBatchNormalizedQuantity: string;
  standardBatchCanonicalUnitId: string;
  standardBatchCanonicalCode: string;
  standardBatchCanonicalSymbol: string;
  standardBatchDimension: UnitDimension;
  expectedOutputEnteredQuantity: string | null;
  expectedOutputUnitId: string | null;
  expectedOutputUnitCode: string | null;
  expectedOutputUnitSymbol: string | null;
  expectedOutputNormalizedQuantity: string | null;
  expectedOutputCanonicalUnitId: string | null;
  expectedOutputCanonicalCode: string | null;
  expectedOutputCanonicalSymbol: string | null;
  expectedOutputDimension: UnitDimension | null;
  expectedYieldPercent: string | null;
  notes: string | null;
  effectiveDate: Date | null;
  createdByName: string;
  approvedByName: string | null;
  approvedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  ingredients: readonly RecipeIngredientRecord[];
  packagingLines: readonly PackagingBomLineRecord[];
  history: readonly {
    id: string;
    version: number;
    status: RecipeStatus;
    effectiveDate: Date | null;
    approvedAt: Date | null;
  }[];
};
export type RecipeSummary = Omit<RecipeRecord, "ingredients" | "packagingLines" | "history">;
export type RecipeQuery = {
  page: number;
  query: string;
  finishedGoodId?: string | undefined;
  status?: RecipeStatus | undefined;
  version?: number | undefined;
};
export type RecipePage = {
  records: readonly RecipeSummary[];
  page: number;
  pageCount: number;
  total: number;
};
export type ScaleRecipeResult = {
  targetEnteredQuantity: string;
  targetEnteredUnitCode: string;
  targetNormalizedQuantity: string;
  targetCanonicalUnitCode: string;
  scaleFactor: string;
  ingredients: readonly {
    itemCode: string;
    itemName: string;
    standardNormalizedQuantity: string;
    scaledNormalizedQuantity: string;
    plannedIssueNormalizedQuantity: string;
    canonicalUnitCode: string;
    canonicalUnitSymbol: string;
    allowancePercent: string;
  }[];
};
export type PackagingRequirementResult = {
  cartons: string;
  loosePieces: string;
  totalPieces: string;
  lines: readonly {
    itemCode: string;
    itemName: string;
    usageBasis: PackagingUsageBasis;
    basisQuantity: string;
    standardRequiredQuantity: string;
    recommendedIssueQuantity: string;
    canonicalUnitCode: string;
    canonicalUnitSymbol: string;
    allowancePercent: string;
  }[];
};
export type RecipeMutationResult = { ok: true; id?: string } | { ok: false; message: string };

export interface RecipeRepository {
  listCatalogItems(): Promise<readonly RecipeItemOption[]>;
  listRecipeUnits(): Promise<readonly RecipeUnit[]>;
  createRecipe(input: RecipeInput): Promise<string>;
  updateRecipe(input: RecipeInput & { id: string }): Promise<string>;
  approveRecipe(id: string, actorUserId: string): Promise<void>;
  inactivateRecipe(id: string): Promise<void>;
  createNewVersion(id: string, actorUserId: string): Promise<string>;
  getRecipe(id: string): Promise<RecipeRecord | null>;
  listRecipes(query: RecipeQuery): Promise<RecipePage>;
  scaleRecipe(id: string, targetQuantity: string, targetUnitId: string): Promise<ScaleRecipeResult>;
  calculatePackaging(
    id: string,
    cartons: string,
    loosePieces: string,
  ): Promise<PackagingRequirementResult>;
}

export function requireProductionManager(actor: ApplicationPrincipal): RecipeMutationResult | null {
  return actor.active && actor.permissions.includes("production.manage")
    ? null
    : { ok: false, message: "Production management permission is required." };
}

export class RecipeRepositoryError extends Error {
  constructor(
    readonly reason: "not-found" | "invalid-reference" | "invalid-state" | "conflict",
    message: string,
  ) {
    super(message);
    this.name = "RecipeRepositoryError";
  }
}
