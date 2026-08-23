import { PURCHASE_RETURN_STATUSES, type PurchaseReturnStatus } from "./return-contracts";

export function parsePurchaseReturnStatus(value?: string): PurchaseReturnStatus | undefined {
  return PURCHASE_RETURN_STATUSES.find((status) => status === value);
}
