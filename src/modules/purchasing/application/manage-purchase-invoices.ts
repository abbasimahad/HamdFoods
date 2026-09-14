import { z } from "zod";
import type { ApplicationPrincipal } from "@/modules/access/domain/principal";
import { requirePurchasingManager, type PurchasingMutationResult } from "./contracts";
import type { PurchaseInvoiceInput, PurchaseInvoiceRepository } from "./purchase-invoice-contracts";

const optional = (max: number) => z.string().trim().max(max).optional();
const matchSchema = z.object({
  goodsReceiptLineId: z.string().uuid(),
  matchedQuantity: z.string().trim().min(1).max(80),
});
const lineSchema = z.object({
  purchaseOrderLineId: z.string().uuid(),
  invoicedQuantity: z.string().trim().min(1).max(80),
  invoicedUnitRate: z.string().trim().min(1).max(80),
  taxPercent: z.string().trim().min(1).max(20),
  notes: optional(500),
  matches: z.array(matchSchema).max(50),
});
const invoiceSchema = z.object({
  id: z.string().uuid().optional(),
  supplierId: z.string().uuid(),
  supplierInvoiceNumber: z.string().trim().min(1).max(120),
  invoiceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  dueDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  notes: optional(2000),
  lines: z.array(lineSchema).min(1).max(100),
});

export async function savePurchaseInvoice(
  actor: ApplicationPrincipal,
  form: Record<string, unknown>,
  repository: PurchaseInvoiceRepository,
): Promise<PurchasingMutationResult> {
  const denied = requirePurchasingManager(actor);
  if (denied) return denied;
  const lines = decode(form.linesJson);
  if (!lines.ok) return { ok: false, message: "Purchase invoice lines are invalid." };
  const parsed = invoiceSchema.safeParse({
    ...form,
    id: text(form.id),
    supplierInvoiceNumber: text(form.supplierInvoiceNumber),
    dueDate: text(form.dueDate),
    notes: text(form.notes),
    lines: lines.value,
  });
  if (!parsed.success)
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid purchase invoice." };
  const input: PurchaseInvoiceInput = { ...parsed.data, actorUserId: actor.id };
  try {
    const id = input.id
      ? await repository.updatePurchaseInvoice({ ...input, id: input.id })
      : await repository.createPurchaseInvoice(input);
    return { ok: true, id };
  } catch (error) {
    return failure(error, "Purchase invoice could not be saved.");
  }
}

export async function postPurchaseInvoice(
  actor: ApplicationPrincipal,
  id: string,
  repository: PurchaseInvoiceRepository,
): Promise<PurchasingMutationResult> {
  return lifecycle(actor, id, repository, (actorId) => repository.postPurchaseInvoice(id, actorId));
}

export async function cancelPurchaseInvoice(
  actor: ApplicationPrincipal,
  id: string,
  reason: string,
  repository: PurchaseInvoiceRepository,
): Promise<PurchasingMutationResult> {
  const denied = requirePurchasingManager(actor);
  if (denied) return denied;
  const parsed = z
    .object({ id: z.string().uuid(), reason: z.string().trim().min(3).max(1000) })
    .safeParse({ id, reason });
  if (!parsed.success)
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid cancellation." };
  try {
    await repository.cancelPurchaseInvoice(id, parsed.data.reason, actor.id);
    return { ok: true, id };
  } catch (error) {
    return failure(error, "Purchase invoice could not be cancelled.");
  }
}

export async function reversePurchaseInvoice(
  actor: ApplicationPrincipal,
  id: string,
  reason: string,
  repository: PurchaseInvoiceRepository,
): Promise<PurchasingMutationResult> {
  const denied = requirePurchasingManager(actor);
  if (denied) return denied;
  const parsed = z
    .object({ id: z.string().uuid(), reason: z.string().trim().min(3).max(1000) })
    .safeParse({ id, reason });
  if (!parsed.success)
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid reversal." };
  try {
    await repository.reversePurchaseInvoice(id, parsed.data.reason, actor.id);
    return { ok: true, id };
  } catch (error) {
    return failure(error, "Purchase invoice could not be reversed.");
  }
}

async function lifecycle(
  actor: ApplicationPrincipal,
  id: string,
  repository: PurchaseInvoiceRepository,
  operation: (actorId: string) => Promise<void>,
) {
  const denied = requirePurchasingManager(actor);
  if (denied) return denied;
  if (!z.string().uuid().safeParse(id).success)
    return { ok: false as const, message: "Invalid purchase invoice." };
  try {
    await operation(actor.id);
    return { ok: true as const, id };
  } catch (error) {
    return failure(error, "Purchase invoice operation failed.");
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
