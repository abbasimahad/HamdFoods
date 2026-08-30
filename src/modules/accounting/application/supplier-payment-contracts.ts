import { requireAccountingManager } from "./accounting-permissions";

export type SupplierPaymentAllocationInput = {
  payableLedgerEntryId: string;
  allocatedAmount: string;
};
export type SupplierPaymentInput = {
  supplierId: string;
  paymentDate: Date;
  treasuryAccountId: string;
  method: "CASH" | "BANK_TRANSFER" | "CHEQUE" | "CARD" | "OTHER";
  totalAmount: string;
  referenceNumber?: string | undefined;
  bankReference?: string | undefined;
  chequeNumber?: string | undefined;
  chequeDate?: Date | undefined;
  notes?: string | undefined;
  allocations: readonly SupplierPaymentAllocationInput[];
};
export interface SupplierPaymentRepository {
  save(actorUserId: string, input: SupplierPaymentInput): Promise<string>;
  post(id: string, actorUserId: string): Promise<void>;
  cancel(id: string, actorUserId: string, reason: string): Promise<void>;
  reverse(id: string, actorUserId: string, reversalDate: Date, reason: string): Promise<string>;
  allocate(
    id: string,
    allocations: readonly SupplierPaymentAllocationInput[],
    actorUserId: string,
  ): Promise<void>;
}
export { requireAccountingManager };
