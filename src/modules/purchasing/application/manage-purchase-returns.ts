import { z } from "zod";
import type { ApplicationPrincipal } from "@/modules/access/domain/principal";
import type { PurchasingMutationResult } from "./contracts";
import {
  PURCHASE_RETURN_REASONS,
  requirePurchaseReturnManager,
  type PurchaseReturnInput,
  type PurchaseReturnRepository,
  type PurchasedMaterialQuarantineInput,
} from "./return-contracts";

const optional = (max: number) => z.string().trim().max(max).optional();
const lineSchema = z.object({
  sourceKey: z.string().trim().min(4).max(100),
  quantity: z.string().trim().min(1).max(80),
  unitId: z.string().uuid(),
  reason: z.enum(PURCHASE_RETURN_REASONS),
  replacementExpected: z.boolean(),
  notes: optional(500),
});
const returnSchema = z.object({
  id: z.string().uuid().optional(),
  returnDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  reasonNotes: optional(2000),
  supplierReturnReference: optional(120),
  lines: z.array(lineSchema).min(1).max(100),
});
const quarantineSchema = z.object({
  inventoryLotId: z.string().uuid(),
  warehouseId: z.string().uuid(),
  quantity: z.string().trim().min(1).max(80),
  unitId: z.string().uuid(),
  reason: z.enum(PURCHASE_RETURN_REASONS).refine((reason) => reason !== "QC_REJECTED", {
    message: "Select the discovered defect reason.",
  }),
  notes: optional(1000),
});

export async function savePurchaseReturn(
  actor: ApplicationPrincipal,
  form: Record<string, unknown>,
  repository: PurchaseReturnRepository,
): Promise<PurchasingMutationResult> {
  const denied = requirePurchaseReturnManager(actor);
  if (denied) return denied;
  const lines = decode(form.linesJson);
  if (!lines.ok) return { ok: false, message: "Purchase return lines are invalid." };
  const parsed = returnSchema.safeParse({
    ...form,
    id: text(form.id),
    reasonNotes: text(form.reasonNotes),
    supplierReturnReference: text(form.supplierReturnReference),
    lines: lines.value,
  });
  if (!parsed.success)
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid purchase return." };
  const input: PurchaseReturnInput = { ...parsed.data, actorUserId: actor.id };
  try {
    const id = input.id
      ? await repository.updatePurchaseReturn({ ...input, id: input.id })
      : await repository.createPurchaseReturn(input);
    return { ok: true, id };
  } catch (error) {
    return failure(error, "Purchase return could not be saved.");
  }
}

export async function postPurchaseReturn(
  actor: ApplicationPrincipal,
  id: string,
  repository: PurchaseReturnRepository,
): Promise<PurchasingMutationResult> {
  return lifecycle(actor, id, repository, (actorId) => repository.postPurchaseReturn(id, actorId));
}
export async function cancelPurchaseReturn(
  actor: ApplicationPrincipal,
  id: string,
  reason: string,
  repository: PurchaseReturnRepository,
): Promise<PurchasingMutationResult> {
  const denied = requirePurchaseReturnManager(actor);
  if (denied) return denied;
  const parsed = z
    .object({ id: z.string().uuid(), reason: z.string().trim().min(3).max(1000) })
    .safeParse({ id, reason });
  if (!parsed.success)
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid cancellation." };
  try {
    await repository.cancelPurchaseReturn(id, parsed.data.reason, actor.id);
    return { ok: true, id };
  } catch (error) {
    return failure(error, "Purchase return could not be cancelled.");
  }
}
export async function quarantinePurchasedMaterial(
  actor: ApplicationPrincipal,
  form: Record<string, unknown>,
  repository: PurchaseReturnRepository,
): Promise<PurchasingMutationResult> {
  const denied = requirePurchaseReturnManager(actor);
  if (denied) return denied;
  const parsed = quarantineSchema.safeParse({ ...form, notes: text(form.notes) });
  if (!parsed.success)
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid quarantine request." };
  try {
    const input: PurchasedMaterialQuarantineInput = { ...parsed.data, actorUserId: actor.id };
    return { ok: true, id: await repository.quarantinePurchasedMaterial(input) };
  } catch (error) {
    return failure(error, "Purchased material could not be quarantined.");
  }
}
async function lifecycle(
  actor: ApplicationPrincipal,
  id: string,
  repository: PurchaseReturnRepository,
  operation: (actorId: string) => Promise<void>,
) {
  const denied = requirePurchaseReturnManager(actor);
  if (denied) return denied;
  if (!z.string().uuid().safeParse(id).success)
    return { ok: false as const, message: "Invalid purchase return." };
  try {
    await operation(actor.id);
    return { ok: true as const, id };
  } catch (error) {
    return failure(error, "Purchase return operation failed.");
  }
}
function decode(value: unknown): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(String(value ?? "[]")) };
  } catch {
    return { ok: false };
  }
}
function text(value: unknown) {
  const result = String(value ?? "").trim();
  return result || undefined;
}
function failure(error: unknown, fallback: string): { ok: false; message: string } {
  return { ok: false, message: error instanceof Error ? error.message : fallback };
}
