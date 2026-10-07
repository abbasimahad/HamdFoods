"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { SalesActionState } from "@/components/sales/action-state";
import {
  saveArea,
  saveCustomer,
  saveCustomerGroup,
  saveRoute,
  saveSalesperson,
  setSalesMasterActive,
} from "@/modules/sales/application/manage-sales";
import { requirePermission } from "@/server/auth/licensed-guards";
import { PrismaSalesRepository } from "@/server/sales/prisma-sales-repository";

const repository = new PrismaSalesRepository();
const result = (value: { ok: boolean; message?: string }, success: string): SalesActionState => ({
  ok: value.ok,
  message: value.ok ? success : (value.message ?? "Action failed."),
});
const paths = [
  "/sales",
  "/sales/customers",
  "/sales/customer-groups",
  "/sales/areas",
  "/sales/routes",
  "/sales/salespersons",
];
function refresh(id?: string) {
  paths.forEach((path) => revalidatePath(path));
  if (id) revalidatePath(`/sales/customers/${id}`);
}
async function run(
  operation: (
    actor: Awaited<ReturnType<typeof requirePermission>>,
    data: Record<string, unknown>,
    repository: PrismaSalesRepository,
  ) => Promise<{ ok: boolean; id?: string; message?: string }>,
  formData: FormData,
  success: string,
  createdRoute?: (id: string) => string,
) {
  const actor = await requirePermission("sales.manage");
  const value = await operation(actor, Object.fromEntries(formData), repository);
  if (value.ok) refresh(value.id);
  // UX-12: a create lands on a page that confirms it, instead of a message inside a collapsed form.
  if (value.ok && value.id && createdRoute && !formData.get("id")) redirect(createdRoute(value.id));
  return result(value, success);
}
const createdIn = (route: string, formData: FormData) => () =>
  `${route}?created=${encodeURIComponent(String(formData.get("name") ?? formData.get("code") ?? ""))}`;
export async function saveCustomerAction(_: SalesActionState, formData: FormData) {
  return run(saveCustomer, formData, "Customer saved.", (id) => `/sales/customers/${id}?created=1`);
}
export async function saveCustomerGroupAction(_: SalesActionState, formData: FormData) {
  return run(
    saveCustomerGroup,
    formData,
    "Customer group saved.",
    createdIn("/sales/customer-groups", formData),
  );
}
export async function saveAreaAction(_: SalesActionState, formData: FormData) {
  return run(saveArea, formData, "Area saved.", createdIn("/sales/areas", formData));
}
export async function saveRouteAction(_: SalesActionState, formData: FormData) {
  return run(saveRoute, formData, "Route saved.", createdIn("/sales/routes", formData));
}
export async function saveSalespersonAction(_: SalesActionState, formData: FormData) {
  const actor = await requirePermission("sales.manage");
  const data: Record<string, unknown> = {
    ...Object.fromEntries(formData),
    areaIds: formData.getAll("areaIds"),
    routeIds: formData.getAll("routeIds"),
  };
  const value = await saveSalesperson(actor, data, repository);
  if (value.ok) refresh(value.id);
  if (value.ok && value.id && !formData.get("id"))
    redirect(createdIn("/sales/salespersons", formData)());
  return result(value, "Salesperson saved.");
}
async function setStatus(
  formData: FormData,
  operation: (id: string, active: boolean) => Promise<boolean>,
) {
  const actor = await requirePermission("sales.manage");
  const value = await setSalesMasterActive(
    actor,
    String(formData.get("id") ?? ""),
    formData.get("active") === "true",
    operation,
  );
  if (value.ok) refresh(value.id);
  return result(value, "Status updated.");
}
export async function setCustomerStatusAction(_: SalesActionState, formData: FormData) {
  return setStatus(formData, repository.setCustomerActive.bind(repository));
}
export async function setCustomerGroupStatusAction(_: SalesActionState, formData: FormData) {
  return setStatus(formData, repository.setCustomerGroupActive.bind(repository));
}
export async function setAreaStatusAction(_: SalesActionState, formData: FormData) {
  return setStatus(formData, repository.setAreaActive.bind(repository));
}
export async function setRouteStatusAction(_: SalesActionState, formData: FormData) {
  return setStatus(formData, repository.setRouteActive.bind(repository));
}
export async function setSalespersonStatusAction(_: SalesActionState, formData: FormData) {
  return setStatus(formData, repository.setSalespersonActive.bind(repository));
}
