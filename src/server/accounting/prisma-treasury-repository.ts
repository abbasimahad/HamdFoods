import "server-only";

import type {
  TreasuryAccountInput,
  TreasuryRepository,
  TreasuryTransferInput,
} from "@/modules/accounting/application/treasury-contracts";
import {
  cancelTreasuryTransfer,
  createTreasuryAccount,
  postTreasuryTransfer,
  reverseTreasuryTransfer,
  saveTreasuryTransfer,
} from "./prisma-phase23-repository";

export class PrismaTreasuryRepository implements TreasuryRepository {
  createAccount(actorUserId: string, input: TreasuryAccountInput) {
    return createTreasuryAccount(actorUserId, input);
  }
  saveTransfer(actorUserId: string, input: TreasuryTransferInput) {
    return saveTreasuryTransfer(actorUserId, input);
  }
  postTransfer(id: string, actorUserId: string) {
    return postTreasuryTransfer(id, actorUserId);
  }
  cancelTransfer(id: string, actorUserId: string, reason: string) {
    return cancelTreasuryTransfer(id, actorUserId, reason);
  }
  reverseTransfer(id: string, actorUserId: string, reversalDate: Date, reason: string) {
    return reverseTreasuryTransfer(id, actorUserId, reversalDate, reason);
  }
}
