import type { ApplicationPrincipal } from "@/modules/access/domain/principal";
import {
  requireAccountingManager,
  type SupplierPaymentAllocationInput,
  type SupplierPaymentInput,
  type SupplierPaymentRepository,
} from "./supplier-payment-contracts";

export async function saveSupplierPayment(
  actor: ApplicationPrincipal,
  input: SupplierPaymentInput,
  repository: SupplierPaymentRepository,
) {
  requireAccountingManager(actor);
  return repository.save(actor.id, input);
}
export async function postSupplierPayment(
  actor: ApplicationPrincipal,
  id: string,
  repository: SupplierPaymentRepository,
) {
  requireAccountingManager(actor);
  await repository.post(id, actor.id);
}
export async function cancelSupplierPayment(
  actor: ApplicationPrincipal,
  id: string,
  reason: string,
  repository: SupplierPaymentRepository,
) {
  requireAccountingManager(actor);
  await repository.cancel(id, actor.id, reason);
}
export async function reverseSupplierPayment(
  actor: ApplicationPrincipal,
  id: string,
  reversalDate: Date,
  reason: string,
  repository: SupplierPaymentRepository,
) {
  requireAccountingManager(actor);
  return repository.reverse(id, actor.id, reversalDate, reason);
}
export async function allocateSupplierPayment(
  actor: ApplicationPrincipal,
  id: string,
  allocations: readonly SupplierPaymentAllocationInput[],
  repository: SupplierPaymentRepository,
) {
  requireAccountingManager(actor);
  await repository.allocate(id, allocations, actor.id);
}
