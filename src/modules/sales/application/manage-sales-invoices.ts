import { z } from "zod";
import type { ApplicationPrincipal } from "@/modules/access/domain/principal";
import { SalesInvoiceStatus } from "@/generated/prisma/client";
import {
  requireSalesInvoiceManager,
  type SalesInvoiceInput,
  type SalesInvoiceMutationResult,
  type SalesInvoiceRepository,
} from "./sales-invoice-contracts";
const optional = (max: number) =>
  z.preprocess((value) => String(value ?? "").trim() || undefined, z.string().max(max).optional());
const line = z.object({
  salesDispatchLineId: z.string().uuid(),
  cartons: z.string().trim().max(30),
  loosePieces: z.string().trim().max(30),
  notes: optional(1000),
});
const schema = z.object({
  id: optional(60),
  salesOrderId: z.string().uuid(),
  invoiceDate: z.string().trim(),
  notes: optional(1000),
  lines: z.array(line).min(1).max(200),
});
export async function saveSalesInvoice(
  actor: ApplicationPrincipal,
  form: Record<string, unknown>,
  repository: SalesInvoiceRepository,
): Promise<SalesInvoiceMutationResult> {
  const denied = requireSalesInvoiceManager(actor);
  if (denied) return denied;
  const parsed = schema.safeParse({ ...form, lines: decode(form.linesJson) });
  if (!parsed.success)
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid invoice." };
  try {
    const input: SalesInvoiceInput = { ...parsed.data, actorUserId: actor.id };
    return {
      ok: true,
      id: parsed.data.id
        ? await repository.updateSalesInvoice({ ...input, id: parsed.data.id })
        : await repository.createSalesInvoice(input),
    };
  } catch (error) {
    return fail(error, "Invoice could not be saved.");
  }
}
export async function postSalesInvoice(
  actor: ApplicationPrincipal,
  id: string,
  repository: SalesInvoiceRepository,
): Promise<SalesInvoiceMutationResult> {
  const denied = requireSalesInvoiceManager(actor);
  if (denied) return denied;
  if (!z.string().uuid().safeParse(id).success)
    return { ok: false, message: "Invoice is invalid." };
  try {
    await repository.postSalesInvoice(id, actor.id);
    return { ok: true, id };
  } catch (error) {
    return fail(error, "Invoice could not be posted.");
  }
}
export async function cancelSalesInvoice(
  actor: ApplicationPrincipal,
  id: string,
  reason: string,
  repository: SalesInvoiceRepository,
): Promise<SalesInvoiceMutationResult> {
  const denied = requireSalesInvoiceManager(actor);
  if (denied) return denied;
  const parsed = z
    .object({ id: z.string().uuid(), reason: z.string().trim().min(3).max(1000) })
    .safeParse({ id, reason });
  if (!parsed.success)
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid cancellation." };
  try {
    await repository.cancelSalesInvoice(parsed.data.id, parsed.data.reason, actor.id);
    return { ok: true, id };
  } catch (error) {
    return fail(error, "Invoice could not be cancelled.");
  }
}
export function parseSalesInvoiceStatus(value?: string) {
  return Object.values(SalesInvoiceStatus).includes(value as SalesInvoiceStatus)
    ? (value as SalesInvoiceStatus)
    : undefined;
}
function decode(value: unknown) {
  try {
    return JSON.parse(String(value ?? "[]"));
  } catch {
    return [];
  }
}
function fail(error: unknown, fallback: string): SalesInvoiceMutationResult {
  return { ok: false, message: error instanceof Error ? error.message : fallback };
}
