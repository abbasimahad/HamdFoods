import { z } from "zod";
import {
  SalesReturnInspectionClassification,
  SalesReturnReason,
  SalesReturnStatus,
  SalesReturnType,
} from "@/generated/prisma/client";
import type { ApplicationPrincipal } from "@/modules/access/domain/principal";
import {
  requireSalesReturnManager,
  type ReturnInspectionInput,
  type SalesReturnInput,
  type SalesReturnMutationResult,
  type SalesReturnRepository,
} from "./sales-return-contracts";

const optional = (max: number) =>
  z.preprocess((value) => String(value ?? "").trim() || undefined, z.string().max(max).optional());
const line = z.object({
  salesInvoiceLineId: optional(60),
  salesDispatchLineId: z.string().uuid(),
  salesDispatchAllocationId: z.string().uuid(),
  cartons: z.string().trim().max(30),
  loosePieces: z.string().trim().max(30),
  reason: z.nativeEnum(SalesReturnReason),
  notes: optional(1000),
});
const document = z.object({
  id: optional(60),
  type: z.nativeEnum(SalesReturnType),
  salesInvoiceId: optional(60),
  salesDispatchId: z.string().uuid(),
  receivingWarehouseId: z.string().uuid(),
  returnDate: z.string().trim(),
  customerReference: optional(120),
  notes: optional(1000),
  lines: z.array(line).min(1).max(200),
});
const inspection = z.object({
  salesReturnLineId: z.string().uuid(),
  classification: z.nativeEnum(SalesReturnInspectionClassification),
  quantity: z.string().trim().max(30),
  reason: optional(500),
  notes: optional(1000),
});

export async function saveSalesReturn(
  actor: ApplicationPrincipal,
  form: Record<string, unknown>,
  repository: SalesReturnRepository,
): Promise<SalesReturnMutationResult> {
  const denied = requireSalesReturnManager(actor);
  if (denied) return denied;
  const parsed = document.safeParse({ ...form, lines: decode(form.linesJson) });
  if (!parsed.success)
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid sales return." };
  if ((parsed.data.type === "INVOICED_RETURN") !== Boolean(parsed.data.salesInvoiceId))
    return {
      ok: false,
      message: "An invoiced return requires an invoice; a dispatch refusal must not have one.",
    };
  try {
    const input: SalesReturnInput = { ...parsed.data, actorUserId: actor.id };
    return {
      ok: true,
      id: parsed.data.id
        ? await repository.updateSalesReturn({ ...input, id: parsed.data.id })
        : await repository.createSalesReturn(input),
    };
  } catch (error) {
    return failure(error, "Sales return could not be saved.");
  }
}
export async function receiveSalesReturn(
  actor: ApplicationPrincipal,
  id: string,
  repository: SalesReturnRepository,
): Promise<SalesReturnMutationResult> {
  return runId(
    actor,
    id,
    repository.receiveSalesReturn.bind(repository),
    "Sales return could not be received.",
  );
}
export async function completeSalesReturn(
  actor: ApplicationPrincipal,
  id: string,
  repository: SalesReturnRepository,
): Promise<SalesReturnMutationResult> {
  return runId(
    actor,
    id,
    repository.completeSalesReturn.bind(repository),
    "Sales return could not be completed.",
  );
}
export async function cancelSalesReturn(
  actor: ApplicationPrincipal,
  id: string,
  reason: string,
  repository: SalesReturnRepository,
): Promise<SalesReturnMutationResult> {
  const denied = requireSalesReturnManager(actor);
  if (denied) return denied;
  const parsed = z
    .object({ id: z.string().uuid(), reason: z.string().trim().min(3).max(1000) })
    .safeParse({ id, reason });
  if (!parsed.success)
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid cancellation." };
  try {
    await repository.cancelSalesReturn(parsed.data.id, parsed.data.reason, actor.id);
    return { ok: true, id };
  } catch (error) {
    return failure(error, "Sales return could not be cancelled.");
  }
}
export async function inspectSalesReturn(
  actor: ApplicationPrincipal,
  id: string,
  form: Record<string, unknown>,
  repository: SalesReturnRepository,
): Promise<SalesReturnMutationResult> {
  const denied = requireSalesReturnManager(actor);
  if (denied) return denied;
  const parsed = z
    .object({ id: z.string().uuid(), inspections: z.array(inspection).min(1).max(1000) })
    .safeParse({ id, inspections: decode(form.inspectionsJson) });
  if (!parsed.success)
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid inspection." };
  try {
    await repository.inspectSalesReturn(
      parsed.data.id,
      parsed.data.inspections as readonly ReturnInspectionInput[],
      actor.id,
    );
    return { ok: true, id };
  } catch (error) {
    return failure(error, "Return inspection could not be completed.");
  }
}
export function parseSalesReturnStatus(value?: string) {
  return Object.values(SalesReturnStatus).includes(value as SalesReturnStatus)
    ? (value as SalesReturnStatus)
    : undefined;
}
export function parseSalesReturnType(value?: string) {
  return Object.values(SalesReturnType).includes(value as SalesReturnType)
    ? (value as SalesReturnType)
    : undefined;
}
async function runId(
  actor: ApplicationPrincipal,
  id: string,
  operation: (id: string, actorUserId: string) => Promise<void>,
  fallback: string,
): Promise<SalesReturnMutationResult> {
  const denied = requireSalesReturnManager(actor);
  if (denied) return denied;
  if (!z.string().uuid().safeParse(id).success)
    return { ok: false, message: "Sales return is invalid." };
  try {
    await operation(id, actor.id);
    return { ok: true, id };
  } catch (error) {
    return failure(error, fallback);
  }
}
function decode(value: unknown) {
  try {
    return JSON.parse(String(value ?? "[]"));
  } catch {
    return [];
  }
}
function failure(error: unknown, fallback: string): SalesReturnMutationResult {
  return { ok: false, message: error instanceof Error ? error.message : fallback };
}
