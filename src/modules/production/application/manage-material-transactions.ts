import { z } from "zod";
import type { ApplicationPrincipal } from "@/modules/access/domain/principal";
import {
  MATERIAL_TRANSACTION_TYPES,
  requireProductionMaterialManager,
  type MaterialMutationResult,
  type MaterialTransactionInput,
  type ProductionMaterialRepository,
} from "./material-contracts";

const transactionSchema = z.object({
  id: z.string().uuid().optional(),
  productionBatchId: z.string().uuid(),
  transactionType: z.enum(MATERIAL_TRANSACTION_TYPES),
  transactionDate: z.string().datetime({ local: true }),
  batchRequirementId: z.string().uuid(),
  inventoryLotId: z.string().uuid(),
  quantity: z.string().trim().min(1).max(80),
  unitId: z.string().uuid(),
  destinationWarehouseId: z.string().uuid().optional(),
  notes: z.string().trim().max(1000).optional(),
});

export async function saveMaterialTransaction(
  actor: ApplicationPrincipal,
  form: Record<string, unknown>,
  repository: ProductionMaterialRepository,
): Promise<MaterialMutationResult> {
  const denied = requireProductionMaterialManager(actor);
  if (denied) return denied;
  const parsed = transactionSchema.safeParse({
    ...form,
    id: text(form.id),
    destinationWarehouseId: text(form.destinationWarehouseId),
    notes: text(form.notes),
  });
  if (!parsed.success)
    return {
      ok: false,
      message: parsed.error.issues[0]?.message ?? "Invalid material transaction.",
    };
  if (parsed.data.transactionType === "RETURN" && !parsed.data.destinationWarehouseId)
    return { ok: false, message: "Material return requires a destination warehouse." };
  const input: MaterialTransactionInput = { ...parsed.data, actorUserId: actor.id };
  try {
    const id = input.id
      ? await repository.updateTransaction({ ...input, id: input.id })
      : await repository.createTransaction(input);
    return { ok: true, id };
  } catch (error) {
    return failure(error, "Material transaction could not be saved.");
  }
}

export async function postMaterialTransaction(
  actor: ApplicationPrincipal,
  id: string,
  repository: ProductionMaterialRepository,
): Promise<MaterialMutationResult> {
  return lifecycle(actor, id, repository, () => repository.postTransaction(id, actor.id));
}

export async function cancelMaterialTransaction(
  actor: ApplicationPrincipal,
  id: string,
  reason: string,
  repository: ProductionMaterialRepository,
): Promise<MaterialMutationResult> {
  const parsed = z.string().trim().min(3).max(1000).safeParse(reason);
  if (!parsed.success) return { ok: false, message: "Cancellation reason is required." };
  return lifecycle(actor, id, repository, () =>
    repository.cancelTransaction(id, actor.id, parsed.data),
  );
}

async function lifecycle(
  actor: ApplicationPrincipal,
  id: string,
  repository: ProductionMaterialRepository,
  operation: () => Promise<void>,
): Promise<MaterialMutationResult> {
  const denied = requireProductionMaterialManager(actor);
  if (denied) return denied;
  if (!z.string().uuid().safeParse(id).success)
    return { ok: false, message: "Invalid material transaction." };
  try {
    await operation();
    return { ok: true, id };
  } catch (error) {
    return failure(error, "Material transaction operation failed.");
  }
}

function text(value: unknown) {
  const result = String(value ?? "").trim();
  return result || undefined;
}

function failure(error: unknown, fallback: string): { ok: false; message: string } {
  return { ok: false, message: error instanceof Error ? error.message : fallback };
}
