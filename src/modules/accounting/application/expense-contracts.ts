import { requireAccountingManager } from "./accounting-permissions";

export type ExpenseLineInput = {
  expenseAccountId: string;
  description: string;
  amount: string;
};
export type ExpenseVoucherInput = {
  expenseDate: Date;
  payee?: string | undefined;
  supplierId?: string | undefined;
  treasuryAccountId: string;
  description: string;
  referenceNumber?: string | undefined;
  notes?: string | undefined;
  lines: readonly ExpenseLineInput[];
};
export interface ExpenseRepository {
  save(actorUserId: string, input: ExpenseVoucherInput): Promise<string>;
  post(id: string, actorUserId: string): Promise<void>;
  cancel(id: string, actorUserId: string, reason: string): Promise<void>;
  reverse(id: string, actorUserId: string, reversalDate: Date, reason: string): Promise<string>;
}
export { requireAccountingManager };
