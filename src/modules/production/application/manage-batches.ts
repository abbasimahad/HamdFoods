import { z } from "zod";
import type { ApplicationPrincipal } from "@/modules/access/domain/principal";
import {
  requireBatchManager,
  type ProductionBatchInput,
  type ProductionBatchMutationResult,
  type ProductionBatchRepository,
} from "./batch-contracts";

const decimal = z.string().trim().min(1).max(80);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const batchSchema = z.object({
  id: z.string().uuid().optional(),
  recipeId: z.string().uuid(),
  plannedBatchQuantity: decimal,
  plannedBatchUnitId: z.string().uuid(),
  plannedProductionDate: date,
  targetCompletionDate: date.optional(),
  rawMaterialWarehouseId: z.string().uuid(),
  packagingWarehouseId: z.string().uuid(),
  finishedGoodsDestinationWarehouseId: z.string().uuid(),
  plannedCartons: z.string().trim().regex(/^\d+$/),
  plannedLoosePieces: z.string().trim().regex(/^\d+$/),
  notes: z.string().trim().max(3000).optional(),
});

export async function saveProductionBatch(
  actor: ApplicationPrincipal,
  form: Record<string, unknown>,
  repository: ProductionBatchRepository,
): Promise<ProductionBatchMutationResult> {
  const denied = requireBatchManager(actor);
  if (denied) return denied;
  const parsed = batchSchema.safeParse({
    ...form,
    id: text(form.id),
    targetCompletionDate: text(form.targetCompletionDate),
    notes: text(form.notes),
  });
  if (!parsed.success)
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid production batch." };
  const input: ProductionBatchInput = { ...parsed.data, actorUserId: actor.id };
  try {
    const id = input.id
      ? await repository.updateBatch({ ...input, id: input.id })
      : await repository.createBatch(input);
    return { ok: true, id };
  } catch (error) {
    return failure(error, "Production batch could not be saved.");
  }
}

export async function planProductionBatch(
  actor: ApplicationPrincipal,
  id: string,
  repository: ProductionBatchRepository,
): Promise<ProductionBatchMutationResult> {
  return lifecycle(actor, id, repository, () => repository.planBatch(id, actor.id));
}

export async function releaseProductionBatch(
  actor: ApplicationPrincipal,
  id: string,
  acknowledgeShortage: boolean,
  repository: ProductionBatchRepository,
): Promise<ProductionBatchMutationResult> {
  const denied = requireBatchManager(actor);
  if (denied) return denied;
  if (!z.string().uuid().safeParse(id).success)
    return { ok: false, message: "Invalid production batch." };
  try {
    const hasShortage = await repository.releaseBatch(id, actor.id, acknowledgeShortage);
    return { ok: true, id, hasShortage };
  } catch (error) {
    return failure(error, "Production batch could not be released.");
  }
}

export async function cancelProductionBatch(
  actor: ApplicationPrincipal,
  id: string,
  reason: string,
  repository: ProductionBatchRepository,
): Promise<ProductionBatchMutationResult> {
  const denied = requireBatchManager(actor);
  if (denied) return denied;
  const parsed = z.string().trim().min(3).max(1000).safeParse(reason);
  if (!parsed.success) return { ok: false, message: "Cancellation reason is required." };
  if (!z.string().uuid().safeParse(id).success)
    return { ok: false, message: "Invalid production batch." };
  try {
    await repository.cancelBatch(id, actor.id, parsed.data);
    return { ok: true, id };
  } catch (error) {
    return failure(error, "Production batch could not be cancelled.");
  }
}

async function lifecycle(
  actor: ApplicationPrincipal,
  id: string,
  repository: ProductionBatchRepository,
  operation: () => Promise<void>,
): Promise<ProductionBatchMutationResult> {
  const denied = requireBatchManager(actor);
  if (denied) return denied;
  if (!z.string().uuid().safeParse(id).success)
    return { ok: false, message: "Invalid production batch." };
  try {
    await operation();
    return { ok: true, id };
  } catch (error) {
    return failure(error, "Production batch operation failed.");
  }
}

function text(value: unknown) {
  const result = String(value ?? "").trim();
  return result || undefined;
}

function failure(error: unknown, fallback: string): { ok: false; message: string } {
  return { ok: false, message: error instanceof Error ? error.message : fallback };
}
