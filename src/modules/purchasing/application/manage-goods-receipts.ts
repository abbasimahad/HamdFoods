import { z } from "zod";
import type { ApplicationPrincipal } from "@/modules/access/domain/principal";
import type { PurchasingMutationResult } from "./contracts";
import {
  QC_REJECTION_REASONS,
  type GoodsReceiptInput,
  type GoodsReceiptRepository,
  requireReceivingManager,
} from "./receiving-contracts";

const optional = (max: number) => z.string().trim().max(max).optional();
const lineSchema = z.object({
  purchaseOrderLineId: z.string().uuid(),
  quantity: z.string().trim().min(1).max(80),
  unitId: z.string().uuid(),
  supplierLotNumber: optional(120),
  manufacturingDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  expiryDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  notes: optional(500),
  purchaseReturnLineId: z.string().uuid().optional(),
});
const receiptSchema = z.object({
  id: z.string().uuid().optional(),
  purchaseOrderId: z.string().uuid(),
  receiptDate: z.string().min(16).max(35),
  warehouseId: z.string().uuid(),
  supplierDeliveryNumber: optional(120),
  vehicleReference: optional(120),
  notes: optional(2000),
  lines: z.array(lineSchema).min(1).max(100),
  purpose: z.enum(["PURCHASE", "SUPPLIER_REPLACEMENT"]).default("PURCHASE"),
  purchaseReturnId: z.string().uuid().optional(),
});
const decisionSchema = z.object({
  goodsReceiptLineId: z.string().uuid(),
  acceptedQuantity: z.string().trim().min(1).max(80),
  rejectedQuantity: z.string().trim().min(1).max(80),
  rejectionReason: z.enum(QC_REJECTION_REASONS).optional(),
  rejectionNotes: optional(1000),
});

export async function saveGoodsReceipt(
  actor: ApplicationPrincipal,
  form: Record<string, unknown>,
  repository: GoodsReceiptRepository,
): Promise<PurchasingMutationResult> {
  const denied = requireReceivingManager(actor);
  if (denied) return denied;
  const lines = json(form.linesJson, "Goods receipt lines are invalid.");
  if (!lines.ok) return lines.result;
  const parsed = receiptSchema.safeParse({
    ...form,
    id: text(form.id),
    supplierDeliveryNumber: text(form.supplierDeliveryNumber),
    vehicleReference: text(form.vehicleReference),
    notes: text(form.notes),
    lines: lines.value,
  });
  if (!parsed.success)
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid goods receipt." };
  const input: GoodsReceiptInput = { ...parsed.data, actorUserId: actor.id };
  try {
    const id = input.id
      ? await repository.updateGoodsReceipt({ ...input, id: input.id })
      : await repository.createGoodsReceipt(input);
    return { ok: true, id };
  } catch (error) {
    return failure(error, "Goods receipt could not be saved.");
  }
}

export async function postGoodsReceipt(
  actor: ApplicationPrincipal,
  id: string,
  repository: GoodsReceiptRepository,
): Promise<PurchasingMutationResult> {
  return lifecycle(actor, id, repository, (actorId) => repository.postGoodsReceipt(id, actorId));
}
export async function cancelGoodsReceipt(
  actor: ApplicationPrincipal,
  id: string,
  reason: string,
  repository: GoodsReceiptRepository,
): Promise<PurchasingMutationResult> {
  const denied = requireReceivingManager(actor);
  if (denied) return denied;
  const parsed = z
    .object({ id: z.string().uuid(), reason: z.string().trim().min(3).max(1000) })
    .safeParse({ id, reason });
  if (!parsed.success)
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid cancellation." };
  try {
    await repository.cancelGoodsReceipt(id, parsed.data.reason, actor.id);
    return { ok: true, id };
  } catch (error) {
    return failure(error, "Goods receipt could not be cancelled.");
  }
}
export async function completeGoodsReceiptQc(
  actor: ApplicationPrincipal,
  id: string,
  form: Record<string, unknown>,
  repository: GoodsReceiptRepository,
): Promise<PurchasingMutationResult> {
  const denied = requireReceivingManager(actor);
  if (denied) return denied;
  if (!z.string().uuid().safeParse(id).success)
    return { ok: false, message: "Invalid goods receipt." };
  const decoded = json(form.decisionsJson, "QC decisions are invalid.");
  if (!decoded.ok) return decoded.result;
  const parsed = z.array(decisionSchema).min(1).max(100).safeParse(decoded.value);
  if (!parsed.success)
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid QC decisions." };
  try {
    await repository.completeGoodsReceiptQc(id, parsed.data, actor.id);
    return { ok: true, id };
  } catch (error) {
    return failure(error, "QC could not be completed.");
  }
}
async function lifecycle(
  actor: ApplicationPrincipal,
  id: string,
  repository: GoodsReceiptRepository,
  operation: (actorId: string) => Promise<void>,
): Promise<PurchasingMutationResult> {
  const denied = requireReceivingManager(actor);
  if (denied) return denied;
  if (!z.string().uuid().safeParse(id).success)
    return { ok: false, message: "Invalid goods receipt." };
  try {
    await operation(actor.id);
    return { ok: true, id };
  } catch (error) {
    return failure(error, "Goods receipt operation failed.");
  }
}
function text(value: unknown) {
  const result = String(value ?? "").trim();
  return result || undefined;
}
function json(
  value: unknown,
  message: string,
): { ok: true; value: unknown } | { ok: false; result: { ok: false; message: string } } {
  try {
    return { ok: true, value: JSON.parse(String(value ?? "[]")) };
  } catch {
    return { ok: false, result: { ok: false, message } };
  }
}
function failure(error: unknown, fallback: string): { ok: false; message: string } {
  return { ok: false, message: error instanceof Error ? error.message : fallback };
}
