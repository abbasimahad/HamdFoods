import { z } from "zod";

import type { ApplicationPrincipal } from "@/modules/access/domain/principal";

import {
  type PurchaseOrderInput,
  type PurchasingMutationResult,
  type PurchasingRepository,
  requirePurchasingManager,
} from "./contracts";

const decimal = z.string().trim().min(1).max(80);
const lineSchema = z.object({
  itemId: z.string().uuid(),
  quantity: decimal,
  unitId: z.string().uuid(),
  unitRate: decimal,
  discountPercent: decimal.default("0"),
  taxPercent: decimal.default("0"),
  notes: z.string().trim().max(500).optional(),
});
const orderSchema = z.object({
  id: z.string().uuid().optional(),
  supplierId: z.string().uuid(),
  orderDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  expectedDeliveryDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  supplierReference: z.string().trim().max(100).optional(),
  notes: z.string().trim().max(2000).optional(),
  lines: z.array(lineSchema).min(1).max(100),
});

export async function savePurchaseOrder(
  actor: ApplicationPrincipal,
  form: Record<string, unknown>,
  repository: PurchasingRepository,
): Promise<PurchasingMutationResult> {
  const denied = requirePurchasingManager(actor);
  if (denied) return denied;
  let lines: unknown;
  try {
    lines = JSON.parse(String(form.linesJson ?? "[]"));
  } catch {
    return { ok: false, message: "Purchase-order lines are invalid." };
  }
  const cleaned = {
    ...form,
    id: text(form.id),
    expectedDeliveryDate: text(form.expectedDeliveryDate),
    supplierReference: text(form.supplierReference),
    notes: text(form.notes),
    lines,
  };
  const parsed = orderSchema.safeParse(cleaned);
  if (!parsed.success)
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid purchase order." };
  const input: PurchaseOrderInput = { ...parsed.data, actorUserId: actor.id };
  try {
    const id = input.id
      ? await repository.updatePurchaseOrder({ ...input, id: input.id })
      : await repository.createPurchaseOrder(input);
    return { ok: true, id };
  } catch (error) {
    return safeFailure(error, "Purchase order could not be saved.");
  }
}

export async function approvePurchaseOrder(
  actor: ApplicationPrincipal,
  id: string,
  repository: PurchasingRepository,
): Promise<PurchasingMutationResult> {
  const denied = requirePurchasingManager(actor);
  if (denied) return denied;
  if (!z.string().uuid().safeParse(id).success)
    return { ok: false, message: "Invalid purchase order." };
  try {
    await repository.approvePurchaseOrder(id, actor.id);
    return { ok: true, id };
  } catch (error) {
    return safeFailure(error, "Purchase order could not be approved.");
  }
}

export async function cancelPurchaseOrder(
  actor: ApplicationPrincipal,
  id: string,
  reason: string,
  repository: PurchasingRepository,
): Promise<PurchasingMutationResult> {
  const denied = requirePurchasingManager(actor);
  if (denied) return denied;
  const parsed = z
    .object({ id: z.string().uuid(), reason: z.string().trim().min(3).max(1000) })
    .safeParse({ id, reason });
  if (!parsed.success)
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid cancellation." };
  try {
    await repository.cancelPurchaseOrder(parsed.data.id, parsed.data.reason, actor.id);
    return { ok: true, id };
  } catch (error) {
    return safeFailure(error, "Purchase order could not be cancelled.");
  }
}

function text(value: unknown) {
  const result = String(value ?? "").trim();
  return result || undefined;
}

function safeFailure(error: unknown, fallback: string): { ok: false; message: string } {
  return { ok: false, message: error instanceof Error ? error.message : fallback };
}
