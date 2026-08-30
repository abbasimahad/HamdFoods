import type { ApplicationPrincipal } from "@/modules/access/domain/principal";
import {
  requireAccountingManager,
  type ExpenseRepository,
  type ExpenseVoucherInput,
} from "./expense-contracts";

export async function saveExpenseVoucher(
  actor: ApplicationPrincipal,
  input: ExpenseVoucherInput,
  repository: ExpenseRepository,
) {
  requireAccountingManager(actor);
  return repository.save(actor.id, input);
}
export async function postExpenseVoucher(
  actor: ApplicationPrincipal,
  id: string,
  repository: ExpenseRepository,
) {
  requireAccountingManager(actor);
  await repository.post(id, actor.id);
}
export async function cancelExpenseVoucher(
  actor: ApplicationPrincipal,
  id: string,
  reason: string,
  repository: ExpenseRepository,
) {
  requireAccountingManager(actor);
  await repository.cancel(id, actor.id, reason);
}
export async function reverseExpenseVoucher(
  actor: ApplicationPrincipal,
  id: string,
  reversalDate: Date,
  reason: string,
  repository: ExpenseRepository,
) {
  requireAccountingManager(actor);
  return repository.reverse(id, actor.id, reversalDate, reason);
}
