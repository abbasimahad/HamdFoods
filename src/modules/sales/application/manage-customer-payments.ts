import { z } from "zod";
import { CustomerPaymentMethod, CustomerPaymentStatus } from "@/generated/prisma/client";
import type { ApplicationPrincipal } from "@/modules/access/domain/principal";
import {
  requireCustomerPaymentManager,
  type CustomerPaymentInput,
  type CustomerPaymentMutationResult,
  type CustomerPaymentRepository,
} from "./customer-payment-contracts";

const optional = (max: number) =>
  z.preprocess((value) => String(value ?? "").trim() || undefined, z.string().max(max).optional());
const allocation = z.object({
  salesInvoiceId: z.string().uuid(),
  allocatedAmount: z.string().trim().max(30),
});
const payment = z.object({
  id: optional(60),
  customerId: z.string().uuid(),
  paymentDate: z.string().trim(),
  method: z.nativeEnum(CustomerPaymentMethod),
  totalAmount: z.string().trim().max(30),
  referenceNumber: optional(120),
  bankName: optional(160),
  chequeNumber: optional(120),
  chequeDate: optional(20),
  notes: optional(1000),
  allocations: z.array(allocation).max(200),
});
export async function saveCustomerPayment(
  actor: ApplicationPrincipal,
  form: Record<string, unknown>,
  repository: CustomerPaymentRepository,
): Promise<CustomerPaymentMutationResult> {
  const denied = requireCustomerPaymentManager(actor);
  if (denied) return denied;
  const parsed = payment.safeParse({ ...form, allocations: decode(form.allocationsJson) });
  if (!parsed.success)
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid customer payment." };
  try {
    const input: CustomerPaymentInput = { ...parsed.data, actorUserId: actor.id };
    return {
      ok: true,
      id: parsed.data.id
        ? await repository.updateCustomerPayment({ ...input, id: parsed.data.id })
        : await repository.createCustomerPayment(input),
    };
  } catch (error) {
    return failure(error, "Payment could not be saved.");
  }
}
export async function postCustomerPayment(
  actor: ApplicationPrincipal,
  id: string,
  repository: CustomerPaymentRepository,
): Promise<CustomerPaymentMutationResult> {
  const denied = requireCustomerPaymentManager(actor);
  if (denied) return denied;
  if (!z.string().uuid().safeParse(id).success)
    return { ok: false, message: "Payment is invalid." };
  try {
    await repository.postCustomerPayment(id, actor.id);
    return { ok: true, id };
  } catch (error) {
    return failure(error, "Payment could not be posted.");
  }
}
export async function cancelCustomerPayment(
  actor: ApplicationPrincipal,
  id: string,
  reason: string,
  repository: CustomerPaymentRepository,
): Promise<CustomerPaymentMutationResult> {
  const denied = requireCustomerPaymentManager(actor);
  if (denied) return denied;
  const parsed = z
    .object({ id: z.string().uuid(), reason: z.string().trim().min(3).max(1000) })
    .safeParse({ id, reason });
  if (!parsed.success)
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid cancellation." };
  try {
    await repository.cancelCustomerPayment(parsed.data.id, parsed.data.reason, actor.id);
    return { ok: true, id };
  } catch (error) {
    return failure(error, "Payment could not be cancelled.");
  }
}
export async function reverseCustomerPayment(
  actor: ApplicationPrincipal,
  id: string,
  reversalDate: Date,
  reason: string,
  repository: CustomerPaymentRepository,
): Promise<string | CustomerPaymentMutationResult> {
  const denied = requireCustomerPaymentManager(actor);
  if (denied) return denied;
  return repository.reverseCustomerPayment(id, actor.id, reversalDate, reason);
}
export async function allocateCustomerCredit(
  actor: ApplicationPrincipal,
  id: string,
  form: Record<string, unknown>,
  repository: CustomerPaymentRepository,
): Promise<CustomerPaymentMutationResult> {
  const denied = requireCustomerPaymentManager(actor);
  if (denied) return denied;
  const parsed = z
    .object({ id: z.string().uuid(), allocations: z.array(allocation).min(1).max(200) })
    .safeParse({ id, allocations: decode(form.allocationsJson) });
  if (!parsed.success)
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid allocation." };
  try {
    await repository.allocatePostedCustomerCredit(
      parsed.data.id,
      parsed.data.allocations,
      actor.id,
    );
    return { ok: true, id };
  } catch (error) {
    return failure(error, "Credit could not be allocated.");
  }
}
export function parseCustomerPaymentStatus(value?: string) {
  return Object.values(CustomerPaymentStatus).includes(value as CustomerPaymentStatus)
    ? (value as CustomerPaymentStatus)
    : undefined;
}
export function parseCustomerPaymentMethod(value?: string) {
  return Object.values(CustomerPaymentMethod).includes(value as CustomerPaymentMethod)
    ? (value as CustomerPaymentMethod)
    : undefined;
}
function decode(value: unknown) {
  try {
    return JSON.parse(String(value ?? "[]"));
  } catch {
    return [];
  }
}
function failure(error: unknown, fallback: string): CustomerPaymentMutationResult {
  return { ok: false, message: error instanceof Error ? error.message : fallback };
}
