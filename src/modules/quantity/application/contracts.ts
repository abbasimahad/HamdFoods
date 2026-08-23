import type { UnitDimension } from "@/modules/master-data/domain/master-data";
import type { QuantityUnit } from "@/modules/quantity/domain/quantity";

export type QuantityUnitRecord = QuantityUnit & {
  id: string;
  name: string;
};

export type FinishedGoodCalculatorRecord = {
  id: string;
  code: string;
  name: string;
  netContentQuantity: string;
  netContentUnit: QuantityUnitRecord;
  netContentUnitDimension: UnitDimension;
  piecesPerCarton: number;
};

export type FinishedGoodOption = Pick<FinishedGoodCalculatorRecord, "id" | "code" | "name">;

export type QuantityCatalog = {
  listActiveSupportedUnits(): Promise<readonly QuantityUnitRecord[]>;
  listActiveFinishedGoods(): Promise<readonly FinishedGoodOption[]>;
  getActiveUnit(id: string): Promise<QuantityUnitRecord | null>;
  getActiveFinishedGood(id: string): Promise<FinishedGoodCalculatorRecord | null>;
};

export type QuantityCalculatorResult =
  | { kind: "idle" }
  | { kind: "error"; calculation: "unit" | "carton" | null; message: string }
  | {
      kind: "unit";
      inputText: string;
      resultText: string;
    }
  | {
      kind: "carton";
      productName: string;
      productDefinition: string;
      normalizedBreakdown: string;
      totalPieces: string;
      totalContent: string;
    };
