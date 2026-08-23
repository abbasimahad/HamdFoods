import { z } from "zod";

import type { ApplicationPrincipal } from "@/modules/access/domain/principal";

import {
  type PurchasingMutationResult,
  type PurchasingRepository,
  requirePurchasingManager,
} from "./contracts";

const optionalText = (max: number) =>
  z.preprocess(
    (value) => (String(value ?? "").trim() ? String(value).trim() : undefined),
    z.string().max(max).optional(),
  );

const supplierSchema = z.object({
  id: optionalText(50),
  code: z.string().trim().min(2).max(30).transform(normalizeCode).pipe(z.string().min(2).max(30)),
  name: z.string().trim().min(2).max(160),
  contactPerson: z.string().trim().min(2).max(120),
  phone: z.string().trim().min(5).max(40),
  secondaryPhone: optionalText(40),
  email: z.string().trim().email().max(160),
  address: z.string().trim().min(5).max(500),
  city: z.string().trim().min(2).max(100),
  taxRegistrationNo: optionalText(80),
  paymentTermsDays: z.preprocess(
    (value) => (String(value ?? "").trim() ? Number(value) : undefined),
    z.number().int().min(0).max(3650).optional(),
  ),
  notes: optionalText(1000),
});

export async function saveSupplier(
  actor: ApplicationPrincipal,
  input: Record<string, unknown>,
  repository: PurchasingRepository,
): Promise<PurchasingMutationResult> {
  const denied = requirePurchasingManager(actor);
  if (denied) return denied;
  const parsed = supplierSchema.safeParse(input);
  if (!parsed.success)
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid supplier." };
  try {
    return {
      ok: true,
      id: await repository.saveSupplier({
        ...parsed.data,
        secondaryPhone: parsed.data.secondaryPhone ?? null,
        taxRegistrationNo: parsed.data.taxRegistrationNo ?? null,
        paymentTermsDays: parsed.data.paymentTermsDays ?? null,
        notes: parsed.data.notes ?? null,
      }),
    };
  } catch (error) {
    return safeFailure(error, "Supplier could not be saved.");
  }
}

export async function setSupplierActive(
  actor: ApplicationPrincipal,
  id: string,
  active: boolean,
  repository: PurchasingRepository,
): Promise<PurchasingMutationResult> {
  const denied = requirePurchasingManager(actor);
  if (denied) return denied;
  try {
    return (await repository.setSupplierActive(id, active))
      ? { ok: true, id }
      : { ok: false, message: "Supplier no longer exists." };
  } catch (error) {
    return safeFailure(error, "Supplier status could not be updated.");
  }
}

function normalizeCode(value: string) {
  return value
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function safeFailure(error: unknown, fallback: string): { ok: false; message: string } {
  return { ok: false, message: error instanceof Error ? error.message : fallback };
}
