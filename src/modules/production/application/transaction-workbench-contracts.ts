export type ProductionTransactionQuery = {
  query: string;
  type?: string | undefined;
  status?: string | undefined;
  page: number;
};
export type ProductionTransactionSummary = {
  id: string;
  number: string;
  batchId: string;
  batchNumber: string;
  product: string;
  type: string;
  status: string;
  date: Date;
};
export type EligibleProductionBatch = {
  id: string;
  number: string;
  status: string;
  product: string;
};
export type ProductionTransactionPage = {
  records: readonly ProductionTransactionSummary[];
  page: number;
  pageCount: number;
  total: number;
};
