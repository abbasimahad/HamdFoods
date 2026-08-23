import { z } from "zod";
import type { ApplicationPrincipal } from "@/modules/access/domain/principal";
import type { MaterialMutationResult } from "./material-contracts";
import {
  PRODUCTION_LOSS_NATURES,
  PRODUCTION_LOSS_REASONS,
  PRODUCTION_OUTPUT_TYPES,
  requireOutputManager,
  type OutputTransactionInput,
  type ProductionOutputRepository,
} from "./output-contracts";

const schema = z.object({
  id: z.string().uuid().optional(),
  productionBatchId: z.string().uuid(),
  outputType: z.enum(PRODUCTION_OUTPUT_TYPES),
  transactionDate: z.string().datetime({ local: true }),
  cartons: z.string().trim().max(30).optional(),
  loosePieces: z.string().trim().max(30).optional(),
  quantity: z.string().trim().max(80).optional(),
  unitId: z.string().uuid().optional(),
  productionDate: z.string().date(),
  expiryDate: z.string().date().optional(),
  destinationWarehouseId: z.string().uuid(),
  lossReason: z.enum(PRODUCTION_LOSS_REASONS).optional(),
  lossNature: z.enum(PRODUCTION_LOSS_NATURES).optional(),
  notes: z.string().trim().max(1000).optional(),
});

export async function saveOutputTransaction(
  actor: ApplicationPrincipal,
  form: Record<string, unknown>,
  repository: ProductionOutputRepository,
): Promise<MaterialMutationResult> {
  const denied = requireOutputManager(actor);
  if (denied) return denied;
  const parsed = schema.safeParse({
    ...form,
    id: text(form.id),
    cartons: text(form.cartons),
    loosePieces: text(form.loosePieces),
    quantity: text(form.quantity),
    unitId: text(form.unitId),
    expiryDate: text(form.expiryDate),
    lossReason: text(form.lossReason),
    lossNature: text(form.lossNature),
    notes: text(form.notes),
  });
  if (!parsed.success)
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid output transaction." };
  const data = parsed.data;
  if (data.outputType === "GOOD" && data.cartons === undefined && data.loosePieces === undefined)
    return { ok: false, message: "Enter cartons or loose finished pieces." };
  if (data.outputType !== "GOOD" && (!data.quantity || !data.unitId))
    return { ok: false, message: "Enter an output quantity and compatible unit." };
  if (data.outputType !== "GOOD" && (!data.notes || data.notes.length < 3))
    return { ok: false, message: "Non-good output requires explanatory notes." };
  if (
    data.outputType === "PROCESS_LOSS" &&
    (!data.lossReason || !data.lossNature || !data.notes || data.notes.length < 3)
  )
    return { ok: false, message: "Process loss requires classification, nature, and notes." };
  if (data.outputType !== "PROCESS_LOSS" && (data.lossReason || data.lossNature))
    return { ok: false, message: "Loss classification applies only to process loss." };
  const input: OutputTransactionInput = { ...data, actorUserId: actor.id };
  try {
    const id = input.id
      ? await repository.updateTransaction({ ...input, id: input.id })
      : await repository.createTransaction(input);
    return { ok: true, id };
  } catch (error) {
    return failure(error, "Output transaction could not be saved.");
  }
}

export async function postOutputTransaction(
  actor: ApplicationPrincipal,
  id: string,
  repository: ProductionOutputRepository,
) {
  return lifecycle(actor, id, repository, () => repository.postTransaction(id, actor.id));
}
export async function cancelOutputTransaction(
  actor: ApplicationPrincipal,
  id: string,
  reason: string,
  repository: ProductionOutputRepository,
) {
  if (!z.string().trim().min(3).max(1000).safeParse(reason).success)
    return { ok: false as const, message: "Cancellation reason is required." };
  return lifecycle(actor, id, repository, () =>
    repository.cancelTransaction(id, actor.id, reason.trim()),
  );
}
export async function completeProductionBatch(
  actor: ApplicationPrincipal,
  batchId: string,
  explanation: string,
  repository: ProductionOutputRepository,
) {
  const denied = requireOutputManager(actor);
  if (denied) return denied;
  if (!z.string().uuid().safeParse(batchId).success || explanation.length > 2000)
    return { ok: false as const, message: "Invalid batch completion details." };
  try {
    await repository.completeBatch(batchId, actor.id, explanation.trim() || undefined);
    return { ok: true as const, id: batchId };
  } catch (error) {
    return failure(error, "Batch could not be completed.");
  }
}

async function lifecycle(
  actor: ApplicationPrincipal,
  id: string,
  repository: ProductionOutputRepository,
  operation: () => Promise<void>,
): Promise<MaterialMutationResult> {
  const denied = requireOutputManager(actor);
  if (denied) return denied;
  if (!z.string().uuid().safeParse(id).success)
    return { ok: false, message: "Invalid output transaction." };
  try {
    await operation();
    return { ok: true, id };
  } catch (error) {
    return failure(error, "Output operation failed.");
  }
}
function text(value: unknown) {
  const result = String(value ?? "").trim();
  return result || undefined;
}
function failure(error: unknown, fallback: string): { ok: false; message: string } {
  return { ok: false, message: error instanceof Error ? error.message : fallback };
}
