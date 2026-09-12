export type ProductionTransactionKind = "material" | "packaging";
export type ProductionReturnContext = "batch" | "workbench";
export function productionTransactionReturnPath(
  kind: ProductionTransactionKind,
  context: ProductionReturnContext,
  batchId: string,
  transactionId?: string,
) {
  if (context === "batch")
    return `/production/batches/${batchId}/${kind === "material" ? "materials" : "packaging"}`;
  const base =
    kind === "material" ? "/production/material-issues" : "/production/packaging-consumption";
  return transactionId ? `${base}/${transactionId}` : base;
}
