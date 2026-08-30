import { requireAccountingManager } from "./accounting-permissions";

export type TreasuryAccountInput = {
  code: string;
  name: string;
  accountType: "CASH" | "BANK" | "PETTY_CASH" | "CLEARING";
  glAccountId: string;
  bankName?: string | undefined;
  accountTitle?: string | undefined;
  accountNumberMasked?: string | undefined;
  branch?: string | undefined;
  notes?: string | undefined;
};
export type TreasuryTransferInput = {
  sourceTreasuryAccountId: string;
  destinationTreasuryAccountId: string;
  transferDate: Date;
  amount: string;
  referenceNumber?: string | undefined;
  notes?: string | undefined;
};
export interface TreasuryRepository {
  createAccount(actorUserId: string, input: TreasuryAccountInput): Promise<unknown>;
  saveTransfer(actorUserId: string, input: TreasuryTransferInput): Promise<string>;
  postTransfer(id: string, actorUserId: string): Promise<void>;
  cancelTransfer(id: string, actorUserId: string, reason: string): Promise<void>;
  reverseTransfer(
    id: string,
    actorUserId: string,
    reversalDate: Date,
    reason: string,
  ): Promise<string>;
}
export { requireAccountingManager };
