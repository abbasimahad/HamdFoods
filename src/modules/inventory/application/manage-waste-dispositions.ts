import { describeValidationIssue } from "@/server/shared/validation-message";
import { z } from "zod";

import type { ApplicationPrincipal } from "@/modules/access/domain/principal";
import type {
  WasteDispositionDraftInput,
  WasteDispositionMutationResult,
  WasteDispositionRepository,
} from "./waste-disposition-contracts";

const reasons = [
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
const lineSchema = z.object({
  itemId: z.string().uuid(),
  inventoryLotId: z.string().uuid().optional(),
  productionLotId: z.string().uuid().optional(),
  sourceStatus: z.enum(["DAMAGED", "QUARANTINE", "SCRAP"]),
  quantity: z.string().trim().min(1).max(80),
  unitId: z.string().uuid(),
  action: z.enum(["MOVE_TO_SCRAP", "MOVE_TO_REPROCESS", "WRITE_OFF"]),
  reason: z.enum(reasons),
  notes: z.string().trim().max(3000).optional(),
});
const draftSchema = z.object({
  id: z.string().uuid().optional(),
  dispositionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  warehouseId: z.string().uuid(),
  notes: z.string().trim().max(3000).optional(),
  lines: z.array(lineSchema).min(1).max(100),
});

export async function saveWasteDispositionDraft(
  actor: ApplicationPrincipal,
  form: Record<string, unknown>,
  repository: WasteDispositionRepository,
): Promise<WasteDispositionMutationResult> {
  if (!authorized(actor)) return denied();
  const parsed = draftSchema.safeParse(form);
  if (!parsed.success)
    return {
      ok: false,
      message: describeValidationIssue(parsed.error.issues[0]) ?? "Invalid disposition draft.",
    };
  try {
    const input: WasteDispositionDraftInput = { ...parsed.data, actorUserId: actor.id };
    return { ok: true, id: await repository.saveDraft(input) };
  } catch (error) {
    return failure(error, "Disposition draft could not be saved.");
  }
}

export async function postWasteDisposition(
  actor: ApplicationPrincipal,
  id: string,
  repository: WasteDispositionRepository,
) {
  return lifecycle(actor, id, repository, () => repository.post(id, actor.id));
}

export async function cancelWasteDisposition(
  actor: ApplicationPrincipal,
  id: string,
  reason: string,
  repository: WasteDispositionRepository,
) {
  if (!authorized(actor)) return denied();
  if (!z.string().uuid().safeParse(id).success)
    return { ok: false as const, message: "Invalid disposition document." };
  const parsed = z.string().trim().min(3).max(1000).safeParse(reason);
  if (!parsed.success) return { ok: false as const, message: "Cancellation reason is required." };
  try {
    await repository.cancel(id, actor.id, parsed.data);
    return { ok: true as const, id };
  } catch (error) {
    return failure(error, "Disposition cancellation failed.");
  }
}

export async function reverseWasteDisposition(
  actor: ApplicationPrincipal,
  id: string,
  reason: string,
  repository: WasteDispositionRepository,
): Promise<WasteDispositionMutationResult> {
  if (!authorized(actor)) return denied();
  if (!z.string().uuid().safeParse(id).success)
    return { ok: false, message: "Invalid disposition document." };
  const parsed = z.string().trim().min(3).max(1000).safeParse(reason);
  if (!parsed.success) return { ok: false, message: "Reversal reason is required." };
  try {
    return { ok: true, id: await repository.reverse(id, actor.id, parsed.data) };
  } catch (error) {
    return failure(error, "Disposition reversal failed.");
  }
}

async function lifecycle(
  actor: ApplicationPrincipal,
  id: string,
  repository: WasteDispositionRepository,
  operation: () => Promise<void>,
) {
  if (!authorized(actor)) return denied();
  if (!z.string().uuid().safeParse(id).success)
    return { ok: false as const, message: "Invalid disposition document." };
  try {
    await operation();
    return { ok: true as const, id };
  } catch (error) {
    return failure(error, "Disposition operation failed.");
  }
}

function authorized(actor: ApplicationPrincipal) {
  return actor.active && actor.permissions.includes("inventory.manage");
}
function denied() {
  return { ok: false as const, message: "Inventory management permission is required." };
}
function failure(error: unknown, fallback: string) {
  return { ok: false as const, message: error instanceof Error ? error.message : fallback };
}
