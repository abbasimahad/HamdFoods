import { z } from "zod";

import type { ApplicationPrincipal } from "@/modules/access/domain/principal";
import type {
  ReprocessDraftInput,
  ReprocessDraftMetadataInput,
  ReprocessMutationResult,
  ReprocessQualityDecisionInput,
  ReprocessRepository,
} from "./reprocess-contracts";

const decimal = z.string().trim().min(1).max(80);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const draftSchema = z.object({
  sourceProductionLotId: z.string().uuid(),
  sourceWarehouseId: z.string().uuid(),
  sourceQuantity: decimal,
  sourceUnitId: z.string().uuid(),
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
  reason: z.string().trim().min(3).max(1000),
  notes: z.string().trim().max(3000).optional(),
});

export async function saveReprocessDraft(
  actor: ApplicationPrincipal,
  form: Record<string, unknown>,
  repository: ReprocessRepository,
): Promise<ReprocessMutationResult> {
  if (!actor.active || !actor.permissions.includes("production.manage"))
    return { ok: false, message: "Production management permission is required." };
  const parsed = draftSchema.safeParse({
    ...form,
    targetCompletionDate: text(form.targetCompletionDate),
    notes: text(form.notes),
  });
  if (!parsed.success)
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid reprocess draft." };
  const input: ReprocessDraftInput = { ...parsed.data, actorUserId: actor.id };
  try {
    return { ok: true, id: await repository.createDraft(input) };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "Reprocess draft could not be saved.",
    };
  }
}

export async function updateReprocessDraft(
  actor: ApplicationPrincipal,
  form: Record<string, unknown>,
  repository: ReprocessRepository,
): Promise<ReprocessMutationResult> {
  if (!actor.active || !actor.permissions.includes("production.manage"))
    return { ok: false, message: "Production management permission is required." };
  const parsed = z
    .object({
      id: z.string().uuid(),
      reason: z.string().trim().min(3).max(1000),
      notes: z.string().trim().max(3000).optional(),
    })
    .safeParse({ ...form, notes: text(form.notes) });
  if (!parsed.success)
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid reprocess draft." };
  const input: ReprocessDraftMetadataInput = { ...parsed.data, actorUserId: actor.id };
  try {
    await repository.updateDraftMetadata(input);
    return { ok: true, id: input.id };
  } catch (error) {
    return failure(error, "Reprocess draft could not be updated.");
  }
}

const rejectionReasons = [
  "DAMAGED",
  "EXPIRED",
  "SPOILED",
  "CONTAMINATED",
  "PACKAGING_DAMAGE",
  "PRODUCTION_LOSS",
  "QUALITY_REJECT",
  "HANDLING_DAMAGE",
  "OTHER",
] as const;

export async function decideReprocessQuality(
  actor: ApplicationPrincipal,
  form: Record<string, unknown>,
  repository: ReprocessRepository,
): Promise<ReprocessMutationResult> {
  if (!actor.active || !actor.permissions.includes("quality.manage"))
    return { ok: false, message: "Reprocess quality management permission is required." };
  const parsed = z
    .object({
      id: z.string().uuid(),
      decision: z.enum(["APPROVED", "REJECTED"]),
      rejectionReason: z.enum(rejectionReasons).optional(),
      notes: z.string().trim().max(3000).optional(),
    })
    .safeParse({ ...form, rejectionReason: text(form.rejectionReason), notes: text(form.notes) });
  if (!parsed.success)
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid quality decision." };
  if (parsed.data.decision === "REJECTED" && !parsed.data.rejectionReason)
    return { ok: false, message: "A rejection reason is required." };
  if (parsed.data.decision === "APPROVED" && parsed.data.rejectionReason)
    return { ok: false, message: "An approval cannot include a rejection reason." };
  if (parsed.data.rejectionReason === "OTHER" && !parsed.data.notes)
    return { ok: false, message: "Notes are required for the OTHER rejection reason." };
  const input: ReprocessQualityDecisionInput = { ...parsed.data, actorUserId: actor.id };
  try {
    await repository.decideQuality(input);
    return { ok: true, id: input.id };
  } catch (error) {
    return failure(error, "Reprocess quality decision failed.");
  }
}

export async function reserveReprocess(
  actor: ApplicationPrincipal,
  id: string,
  repository: ReprocessRepository,
): Promise<ReprocessMutationResult> {
  return lifecycle(actor, id, repository, () => repository.reserve(id, actor.id));
}

export async function startReprocess(
  actor: ApplicationPrincipal,
  id: string,
  repository: ReprocessRepository,
): Promise<ReprocessMutationResult> {
  return lifecycle(actor, id, repository, () => repository.start(id, actor.id));
}

export async function cancelReprocess(
  actor: ApplicationPrincipal,
  id: string,
  reason: string,
  repository: ReprocessRepository,
): Promise<ReprocessMutationResult> {
  if (!actor.active || !actor.permissions.includes("production.manage"))
    return { ok: false, message: "Production management permission is required." };
  if (!z.string().uuid().safeParse(id).success)
    return { ok: false, message: "Invalid reprocess document." };
  const parsedReason = z.string().trim().min(3).max(1000).safeParse(reason);
  if (!parsedReason.success) return { ok: false, message: "Cancellation reason is required." };
  try {
    await repository.cancel(id, actor.id, parsedReason.data);
    return { ok: true, id };
  } catch (error) {
    return failure(error, "Reprocess cancellation failed.");
  }
}

async function lifecycle(
  actor: ApplicationPrincipal,
  id: string,
  repository: ReprocessRepository,
  operation: () => Promise<void>,
): Promise<ReprocessMutationResult> {
  if (!actor.active || !actor.permissions.includes("production.manage"))
    return { ok: false, message: "Production management permission is required." };
  if (!z.string().uuid().safeParse(id).success)
    return { ok: false, message: "Invalid reprocess document." };
  try {
    await operation();
    return { ok: true, id };
  } catch (error) {
    return failure(error, "Reprocess operation failed.");
  }
}

function text(value: unknown) {
  const result = String(value ?? "").trim();
  return result || undefined;
}

function failure(error: unknown, fallback: string): { ok: false; message: string } {
  return { ok: false, message: error instanceof Error ? error.message : fallback };
}
