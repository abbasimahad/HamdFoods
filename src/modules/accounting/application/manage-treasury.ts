import type { ApplicationPrincipal } from "@/modules/access/domain/principal";
import {
  requireAccountingManager,
  type TreasuryAccountInput,
  type TreasuryRepository,
  type TreasuryTransferInput,
} from "./treasury-contracts";

export async function createTreasuryAccount(
  actor: ApplicationPrincipal,
  input: TreasuryAccountInput,
  repository: TreasuryRepository,
) {
  requireAccountingManager(actor);
  await repository.createAccount(actor.id, input);
}
export async function saveTreasuryTransfer(
  actor: ApplicationPrincipal,
  input: TreasuryTransferInput,
  repository: TreasuryRepository,
) {
  requireAccountingManager(actor);
  return repository.saveTransfer(actor.id, input);
}
export async function postTreasuryTransfer(
  actor: ApplicationPrincipal,
  id: string,
  repository: TreasuryRepository,
) {
  requireAccountingManager(actor);
  await repository.postTransfer(id, actor.id);
}
export async function cancelTreasuryTransfer(
  actor: ApplicationPrincipal,
  id: string,
  reason: string,
  repository: TreasuryRepository,
) {
  requireAccountingManager(actor);
  await repository.cancelTransfer(id, actor.id, reason);
}
export async function reverseTreasuryTransfer(
  actor: ApplicationPrincipal,
  id: string,
  reversalDate: Date,
  reason: string,
  repository: TreasuryRepository,
) {
  requireAccountingManager(actor);
  return repository.reverseTransfer(id, actor.id, reversalDate, reason);
}
