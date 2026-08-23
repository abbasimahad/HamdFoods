import { PRODUCTION_BATCH_STATUSES, type ProductionBatchStatus } from "./batch-contracts";

export function parseProductionBatchStatus(value?: string): ProductionBatchStatus | undefined {
  return PRODUCTION_BATCH_STATUSES.find((status) => status === value);
}

export function parseProductionBatchPage(value?: string) {
  const page = Number(value);
  return Number.isInteger(page) && page > 0 ? Math.min(page, 100000) : 1;
}

export function parseProductionBatchDate(value?: string) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== value
    ? undefined
    : date;
}
