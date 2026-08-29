import { z } from "zod";

import type { ApplicationPrincipal } from "@/modules/access/domain/principal";

import type {
  CustomerInput,
  SalesMasterInput,
  SalesMutationResult,
  SalespersonInput,
  SalesRepository,
  SalesRouteInput,
} from "./contracts";
import { requireSalesManager } from "./contracts";

const optionalText = (max: number) =>
  z.preprocess(
    (value) => (String(value ?? "").trim() ? String(value).trim() : null),
    z.string().max(max).nullable(),
  );
const optionalId = optionalText(60);
const code = z.string().trim().min(2).max(30).transform(normalizeCode).pipe(z.string().min(2));
const base = z.object({ id: optionalId, code, name: z.string().trim().min(2).max(160) });
const masterSchema = base.extend({ description: optionalText(1000) });
const routeSchema = masterSchema.extend({ areaId: z.string().uuid() });
const salespersonSchema = base.extend({
  phone: optionalText(40),
  email: z.preprocess(
    (v) => String(v ?? "").trim() || null,
    z.string().email().max(160).nullable(),
  ),
  linkedUserId: optionalId,
  notes: optionalText(1000),
  areaIds: z.array(z.string().uuid()).default([]),
  routeIds: z.array(z.string().uuid()).default([]),
});
const customerSchema = base.extend({
  contactPerson: optionalText(120),
  phone: z.string().trim().min(5).max(40),
  secondaryPhone: optionalText(40),
  email: z.preprocess(
    (v) => String(v ?? "").trim() || null,
    z.string().email().max(160).nullable(),
  ),
  address: z.string().trim().min(5).max(500),
  city: optionalText(100),
  customerGroupId: optionalId,
  areaId: z.string().uuid(),
  routeId: optionalId,
  salespersonId: optionalId,
  taxRegistrationNo: optionalText(80),
  creditLimit: z.preprocess(
    (v) => String(v ?? "").trim() || null,
    z
      .string()
      .regex(/^\d+(\.\d{1,6})?$/)
      .nullable(),
  ),
  paymentTermsDays: z.preprocess(
    (v) => (String(v ?? "").trim() ? Number(v) : null),
    z.number().int().min(0).max(3650).nullable(),
  ),
  notes: optionalText(1000),
});

export async function saveCustomerGroup(
  actor: ApplicationPrincipal,
  data: Record<string, unknown>,
  repository: SalesRepository,
) {
  return save(actor, data, masterSchema, (input) =>
    repository.saveCustomerGroup(input as SalesMasterInput),
  );
}
export async function saveArea(
  actor: ApplicationPrincipal,
  data: Record<string, unknown>,
  repository: SalesRepository,
) {
  return save(actor, data, masterSchema, (input) => repository.saveArea(input as SalesMasterInput));
}
export async function saveRoute(
  actor: ApplicationPrincipal,
  data: Record<string, unknown>,
  repository: SalesRepository,
) {
  return save(actor, data, routeSchema, (input) => repository.saveRoute(input as SalesRouteInput));
}
export async function saveSalesperson(
  actor: ApplicationPrincipal,
  data: Record<string, unknown>,
  repository: SalesRepository,
) {
  const input = { ...data, areaIds: values(data.areaIds), routeIds: values(data.routeIds) };
  return save(actor, input, salespersonSchema, (parsed) =>
    repository.saveSalesperson(parsed as SalespersonInput),
  );
}
export async function saveCustomer(
  actor: ApplicationPrincipal,
  data: Record<string, unknown>,
  repository: SalesRepository,
) {
  return save(actor, data, customerSchema, (input) =>
    repository.saveCustomer(input as CustomerInput),
  );
}
export async function setSalesMasterActive(
  actor: ApplicationPrincipal,
  id: string,
  active: boolean,
  operation: (id: string, active: boolean) => Promise<boolean>,
) {
  const denied = requireSalesManager(actor);
  if (denied) return denied;
  try {
    return (await operation(id, active))
      ? { ok: true, id }
      : { ok: false, message: "Record no longer exists." };
  } catch (error) {
    return failure(error, "Status could not be updated.");
  }
}

async function save<T>(
  actor: ApplicationPrincipal,
  data: Record<string, unknown>,
  schema: z.ZodType<T>,
  operation: (input: T) => Promise<string>,
): Promise<SalesMutationResult> {
  const denied = requireSalesManager(actor);
  if (denied) return denied;
  const parsed = schema.safeParse(data);
  if (!parsed.success)
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid sales master." };
  try {
    return { ok: true, id: await operation(parsed.data) };
  } catch (error) {
    return failure(error, "Record could not be saved.");
  }
}
function values(value: unknown) {
  return Array.isArray(value) ? value.map(String) : value ? [String(value)] : [];
}
function normalizeCode(value: string) {
  return value
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}
function failure(error: unknown, fallback: string): SalesMutationResult {
  return { ok: false, message: error instanceof Error ? error.message : fallback };
}
