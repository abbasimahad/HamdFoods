import "server-only";

import type {
  ExpenseRepository,
  ExpenseVoucherInput,
} from "@/modules/accounting/application/expense-contracts";
import {
  cancelExpenseVoucher,
  postExpenseVoucher,
  reverseExpenseVoucher,
  saveExpenseVoucher,
} from "./prisma-phase23-repository";

export class PrismaExpenseRepository implements ExpenseRepository {
  save(actorUserId: string, input: ExpenseVoucherInput) {
    return saveExpenseVoucher(actorUserId, input);
  }
  post(id: string, actorUserId: string) {
    return postExpenseVoucher(id, actorUserId);
  }
  cancel(id: string, actorUserId: string, reason: string) {
    return cancelExpenseVoucher(id, actorUserId, reason);
  }
  reverse(id: string, actorUserId: string, reversalDate: Date, reason: string) {
    return reverseExpenseVoucher(id, actorUserId, reversalDate, reason);
  }
}
