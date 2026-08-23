import { z } from "zod";
import type { ApplicationPrincipal } from "@/modules/access/domain/principal";
import type { MaterialMutationResult } from "./material-contracts";
import {
  PACKAGING_DAMAGE_REASONS,
  PACKAGING_TRANSACTION_TYPES,
  requirePackagingManager,
  type PackagingTransactionInput,
  type ProductionPackagingRepository,
} from "./packaging-contracts";

const schema = z.object({
  id: z.string().uuid().optional(),
  productionBatchId: z.string().uuid(),
  transactionType: z.enum(PACKAGING_TRANSACTION_TYPES),
  transactionDate: z.string().datetime({ local: true }),
  packagingRequirementId: z.string().uuid(),
  inventoryLotId: z.string().uuid(),
  quantity: z.string().trim().min(1).max(80),
  unitId: z.string().uuid(),
  destinationWarehouseId: z.string().uuid().optional(),
  damageReason: z.enum(PACKAGING_DAMAGE_REASONS).optional(),
  notes: z.string().trim().max(1000).optional(),
});

export async function savePackagingTransaction(
  actor: ApplicationPrincipal,
  form: Record<string, unknown>,
  repository: ProductionPackagingRepository,
): Promise<MaterialMutationResult> {
  const denied = requirePackagingManager(actor);
  if (denied) return denied;
  const parsed = schema.safeParse({
    ...form,
    id: text(form.id),
    destinationWarehouseId: text(form.destinationWarehouseId),
    damageReason: text(form.damageReason),
    notes: text(form.notes),
  });
  if (!parsed.success)
    return {
      ok: false,
      message: parsed.error.issues[0]?.message ?? "Invalid packaging transaction.",
    };
  if (parsed.data.transactionType === "RETURN" && !parsed.data.destinationWarehouseId)
    return { ok: false, message: "Packaging return requires a destination warehouse." };
  if ((parsed.data.transactionType === "DAMAGE") !== Boolean(parsed.data.damageReason))
    return { ok: false, message: "Packaging damage requires one controlled damage reason." };
  if (parsed.data.transactionType === "DAMAGE" && !parsed.data.notes)
    return { ok: false, message: "Packaging damage notes are required." };
  const input: PackagingTransactionInput = { ...parsed.data, actorUserId: actor.id };
  try {
    const id = input.id
      ? await repository.updateTransaction({ ...input, id: input.id })
      : await repository.createTransaction(input);
    return { ok: true, id };
  } catch (error) {
    return fail(error, "Packaging transaction could not be saved.");
  }
}

export async function postPackagingTransaction(
  actor: ApplicationPrincipal,
  id: string,
  repository: ProductionPackagingRepository,
) {
  return lifecycle(actor, id, repository, () => repository.postTransaction(id, actor.id));
}

export async function cancelPackagingTransaction(
  actor: ApplicationPrincipal,
  id: string,
  reason: string,
  repository: ProductionPackagingRepository,
) {
  const parsed = z.string().trim().min(3).max(1000).safeParse(reason);
  if (!parsed.success) return { ok: false as const, message: "Cancellation reason is required." };
  return lifecycle(actor, id, repository, () =>
    repository.cancelTransaction(id, actor.id, parsed.data),
  );
}

async function lifecycle(
  actor: ApplicationPrincipal,
  id: string,
  repository: ProductionPackagingRepository,
  operation: () => Promise<void>,
): Promise<MaterialMutationResult> {
  const denied = requirePackagingManager(actor);
  if (denied) return denied;
  if (!z.string().uuid().safeParse(id).success)
    return { ok: false, message: "Invalid packaging transaction." };
  try {
    await operation();
    return { ok: true, id };
  } catch (error) {
    return fail(error, "Packaging transaction operation failed.");
  }
}

function text(value: unknown) {
  const result = String(value ?? "").trim();
  return result || undefined;
}
function fail(error: unknown, fallback: string): { ok: false; message: string } {
  return { ok: false, message: error instanceof Error ? error.message : fallback };
}
