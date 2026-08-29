import { z } from "zod";
import type { ApplicationPrincipal } from "@/modules/access/domain/principal";
import { SalesDispatchStatus } from "@/generated/prisma/client";
import {
  requireSalesDispatchManager,
  type SalesDispatchInput,
  type SalesDispatchMutationResult,
  type SalesDispatchRepository,
} from "./sales-dispatch-contracts";

const optional = (max: number) =>
  z.preprocess((value) => String(value ?? "").trim() || undefined, z.string().max(max).optional());
const allocation = z.object({
  productionLotId: z.string().uuid(),
  quantity: z.string().trim().max(30),
});
const line = z.object({
  salesOrderLineId: z.string().uuid(),
  cartons: z.string().trim().max(30),
  loosePieces: z.string().trim().max(30),
  notes: optional(1000),
  allocations: z.array(allocation).min(1).max(50),
});
const inputSchema = z.object({
  id: optional(60),
  salesOrderId: z.string().uuid(),
  dispatchDate: z.string().trim(),
  vehicleNumber: optional(80),
  driverName: optional(160),
  driverPhone: optional(80),
  transporter: optional(160),
  gatePassReference: optional(120),
  notes: optional(1000),
  lines: z.array(line).min(1).max(100),
});

export async function saveSalesDispatch(
  actor: ApplicationPrincipal,
  form: Record<string, unknown>,
  repository: SalesDispatchRepository,
): Promise<SalesDispatchMutationResult> {
  const denied = requireSalesDispatchManager(actor);
  if (denied) return denied;
  const parsed = inputSchema.safeParse({ ...form, lines: decode(form.linesJson) });
  if (!parsed.success)
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid dispatch." };
  try {
    const input: SalesDispatchInput = { ...parsed.data, actorUserId: actor.id };
    return {
      ok: true,
      id: parsed.data.id
        ? await repository.updateSalesDispatch({ ...input, id: parsed.data.id })
        : await repository.createSalesDispatch(input),
    };
  } catch (error) {
    return failure(error, "Dispatch could not be saved.");
  }
}
export async function postSalesDispatch(
  actor: ApplicationPrincipal,
  id: string,
  repository: SalesDispatchRepository,
): Promise<SalesDispatchMutationResult> {
  const denied = requireSalesDispatchManager(actor);
  if (denied) return denied;
  if (!z.string().uuid().safeParse(id).success)
    return { ok: false, message: "Dispatch is invalid." };
  try {
    await repository.postSalesDispatch(id, actor.id);
    return { ok: true, id };
  } catch (error) {
    return failure(error, "Dispatch could not be posted.");
  }
}
export async function confirmSalesDispatchDelivery(
  actor: ApplicationPrincipal,
  id: string,
  receiverName: string,
  notes: string,
  repository: SalesDispatchRepository,
): Promise<SalesDispatchMutationResult> {
  const denied = requireSalesDispatchManager(actor);
  if (denied) return denied;
  const parsed = z
    .object({ id: z.string().uuid(), receiverName: optional(160), notes: optional(1000) })
    .safeParse({ id, receiverName, notes });
  if (!parsed.success)
    return {
      ok: false,
      message: parsed.error.issues[0]?.message ?? "Invalid delivery confirmation.",
    };
  try {
    await repository.confirmSalesDispatchDelivery(
      parsed.data.id,
      parsed.data.receiverName,
      parsed.data.notes,
      actor.id,
    );
    return { ok: true, id };
  } catch (error) {
    return failure(error, "Delivery could not be confirmed.");
  }
}
export async function cancelSalesDispatch(
  actor: ApplicationPrincipal,
  id: string,
  reason: string,
  repository: SalesDispatchRepository,
): Promise<SalesDispatchMutationResult> {
  const denied = requireSalesDispatchManager(actor);
  if (denied) return denied;
  const parsed = z
    .object({ id: z.string().uuid(), reason: z.string().trim().min(3).max(1000) })
    .safeParse({ id, reason });
  if (!parsed.success)
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid cancellation." };
  try {
    await repository.cancelSalesDispatch(parsed.data.id, parsed.data.reason, actor.id);
    return { ok: true, id };
  } catch (error) {
    return failure(error, "Dispatch could not be cancelled.");
  }
}
export function parseSalesDispatchStatus(value?: string) {
  return Object.values(SalesDispatchStatus).includes(value as SalesDispatchStatus)
    ? (value as SalesDispatchStatus)
    : undefined;
}
function decode(value: unknown) {
  try {
    return JSON.parse(String(value ?? "[]"));
  } catch {
    return [];
  }
}
function failure(error: unknown, fallback: string): SalesDispatchMutationResult {
  return { ok: false, message: error instanceof Error ? error.message : fallback };
}
