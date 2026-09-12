import { describe, expect, it } from "vitest";
import { productionTransactionReturnPath } from "./transaction-workbench-routing";

describe("production transaction workbench routing", () => {
  it("uses only closed batch and workbench destinations", () => {
    expect(productionTransactionReturnPath("material", "batch", "batch-1")).toBe(
      "/production/batches/batch-1/materials",
    );
    expect(productionTransactionReturnPath("material", "workbench", "batch-1", "tx-1")).toBe(
      "/production/material-issues/tx-1",
    );
    expect(productionTransactionReturnPath("packaging", "workbench", "batch-1")).toBe(
      "/production/packaging-consumption",
    );
  });
});
