import { describeValidationIssue } from "@/server/shared/validation-message";
import { z } from "zod";

import type { ApplicationPrincipal } from "@/modules/access/domain/principal";
import { SALES_ORDER_STATUSES } from "../domain/sales-orders";
import {
  requireSalesOrderManager,
  type SalesOrderInput,
  type SalesOrderMutationResult,
  type SalesOrderRepository,
} from "./sales-order-contracts";

const optional = (max: number) =>
  z.preprocess((value) => String(value ?? "").trim() || undefined, z.string().max(max).optional());
const line = z.object({
  itemId: z.string().uuid(),
  cartons: z.string().trim().max(30),
  loosePieces: z.string().trim().max(30),
  cartonRate: z.string().trim().max(61),
  discount1Percent: z.string().trim().max(30).default("0"),
  discount2Percent: z.string().trim().max(30).default("0"),
  taxPercent: z.string().trim().max(30).default("0"),
  notes: optional(1000),
});
const inputSchema = z.object({
  id: optional(60),
  customerId: z.string().uuid(),
  salespersonId: optional(60),
  areaId: optional(60),
  routeId: optional(60),
  warehouseId: z.string().uuid(),
  orderDate: z.string().trim(),
  deliveryDate: optional(20),
  customerReference: optional(160),
  notes: optional(1000),
  lines: z.array(line).min(1).max(100),
});

export async function saveSalesOrder(
  actor: ApplicationPrincipal,
  form: Record<string, unknown>,
  repository: SalesOrderRepository,
): Promise<SalesOrderMutationResult> {
  const denied = requireSalesOrderManager(actor);
  if (denied) return denied;
  const parsed = inputSchema.safeParse({ ...form, lines: decodeLines(form.linesJson) });
  if (!parsed.success)
    return {
      ok: false,
      message: describeValidationIssue(parsed.error.issues[0]) ?? "Invalid sales order.",
    };
  try {
    const input: SalesOrderInput = { ...parsed.data, actorUserId: actor.id };
    return {
      ok: true,
      id: parsed.data.id
        ? await repository.updateSalesOrder({ ...input, id: parsed.data.id })
        : await repository.createSalesOrder(input),
    };
  } catch (error) {
    return failure(error, "Sales order could not be saved.");
  }
}
const MIN_CREDIT_OVERRIDE_REASON = 15;
export async function approveSalesOrder(
  actor: ApplicationPrincipal,
  id: string,
  repository: SalesOrderRepository,
  creditOverrideReason?: string,
): Promise<SalesOrderMutationResult> {
  if (!actor.active || !actor.permissions.includes("sales.approve"))
    return { ok: false, message: "Sales order approval permission is required." };
  if (!z.string().uuid().safeParse(id).success)
    return { ok: false, message: "Sales order is invalid." };
  // ROLE-3: going over the customer's credit limit needs its own permission and a real reason.
  const override = creditOverrideReason?.trim() || undefined;
  if (override && !actor.permissions.includes("sales.credit_override"))
    return { ok: false, message: "Credit-limit override permission is required." };
  if (override && override.length < MIN_CREDIT_OVERRIDE_REASON)
    return {
      ok: false,
      message: `Explain the credit-limit override (at least ${MIN_CREDIT_OVERRIDE_REASON} characters).`,
    };
  try {
    await repository.approveSalesOrder(id, actor.id, override);
    return { ok: true, id };
  } catch (error) {
    return failure(error, "Sales order could not be approved.");
  }
}
export async function reserveRedeliveryStock(
  actor: ApplicationPrincipal,
  id: string,
  repository: SalesOrderRepository,
): Promise<SalesOrderMutationResult> {
  const denied = requireSalesOrderManager(actor);
  if (denied) return denied;
  if (!z.string().uuid().safeParse(id).success)
    return { ok: false, message: "Sales order is invalid." };
  try {
    await repository.reserveRedeliveryStock(id, actor.id);
    return { ok: true, id };
  } catch (error) {
    return failure(error, "Redelivery stock could not be reserved.");
  }
}
export async function cancelSalesOrder(
  actor: ApplicationPrincipal,
  id: string,
  reason: string,
  repository: SalesOrderRepository,
): Promise<SalesOrderMutationResult> {
  const denied = requireSalesOrderManager(actor);
  if (denied) return denied;
  const parsed = z
    .object({ id: z.string().uuid(), reason: z.string().trim().min(3).max(1000) })
    .safeParse({ id, reason });
  if (!parsed.success)
    return {
      ok: false,
      message: describeValidationIssue(parsed.error.issues[0]) ?? "Invalid cancellation.",
    };
  try {
    await repository.cancelSalesOrder(parsed.data.id, parsed.data.reason, actor.id);
    return { ok: true, id };
  } catch (error) {
    return failure(error, "Sales order could not be cancelled.");
  }
}
export function parseSalesOrderStatus(value?: string) {
  return SALES_ORDER_STATUSES.includes(value as (typeof SALES_ORDER_STATUSES)[number])
    ? (value as (typeof SALES_ORDER_STATUSES)[number])
    : undefined;
}
function decodeLines(value: unknown) {
  try {
    const decoded: unknown = JSON.parse(String(value ?? "[]"));
    return decoded;
  } catch {
    return [];
  }
}
function failure(error: unknown, fallback: string): SalesOrderMutationResult {
  return { ok: false, message: error instanceof Error ? error.message : fallback };
}
