import Link from "next/link";
import { CustomerForm } from "@/components/sales/customer-form";
import { PageHeader } from "@/components/layout/page-header";
import { Card } from "@/components/ui/card";
import { ResponsiveContainer } from "@/components/ui/responsive-container";
import { SearchPagination } from "@/components/master-data/search-pagination";
import { SalesStatusForm } from "@/components/sales/sales-status-form";
import { hasPermission } from "@/modules/access/domain/principal";
import { parseOptionalBoolean, parseSalesPage } from "@/modules/sales/application/listing";
import { requirePermission } from "@/server/auth/server-guards";
import { PrismaSalesRepository } from "@/server/sales/prisma-sales-repository";
import { saveCustomerAction, setCustomerStatusAction } from "../actions";
export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    page?: string;
    customerGroupId?: string;
    areaId?: string;
    salespersonId?: string;
    status?: string;
  }>;
}) {
  const principal = await requirePermission("sales.view");
  const params = await searchParams;
  const query = params.q?.trim().slice(0, 100) ?? "";
  const repository = new PrismaSalesRepository();
  const active = parseOptionalBoolean(params.status);
  const customerQuery = {
    page: parseSalesPage(params.page),
    query,
    ...(params.customerGroupId ? { customerGroupId: params.customerGroupId } : {}),
    ...(params.areaId ? { areaId: params.areaId } : {}),
    ...(params.salespersonId ? { salespersonId: params.salespersonId } : {}),
    ...(active === undefined ? {} : { active }),
  };
  const [result, references] = await Promise.all([
    repository.listCustomers(customerQuery),
    repository.getReferenceData(),
  ]);
  const canManage = hasPermission(principal, "sales.manage");
  return (
    <ResponsiveContainer>
      <PageHeader
        title="Customers"
        description="Sales counterparties and commercial configuration; no sales, receivable, or accounting effects."
      />
      {canManage && (
        <Card className="mb-5 p-5">
          <details>
            <summary className="cursor-pointer font-semibold">Create customer</summary>
            <div className="mt-4">
              <CustomerForm action={saveCustomerAction} references={references} />
            </div>
          </details>
        </Card>
      )}
      <CustomerFilters query={query} params={params} references={references} />
      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[75rem] text-left text-sm">
            <thead className="bg-[var(--surface)]">
              <tr>
                <th className="p-4">Customer</th>
                <th className="p-4">Group</th>
                <th className="p-4">Area / Route</th>
                <th className="p-4">Salesperson</th>
                <th className="p-4">Phone</th>
                <th className="p-4">Credit limit</th>
                <th className="p-4">Status</th>
                <th className="p-4">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {result.records.map((customer) => (
                <tr key={customer.id}>
                  <td className="p-4">
                    <Link
                      className="font-semibold text-[var(--accent)]"
                      href={`/sales/customers/${customer.id}`}
                    >
                      {customer.code} — {customer.name}
                    </Link>
                  </td>
                  <td className="p-4">{customer.customerGroupName ?? "-"}</td>
                  <td className="p-4">
                    {customer.areaName}
                    <span className="block text-xs text-[var(--muted)]">
                      {customer.routeName ?? "No route"}
                    </span>
                  </td>
                  <td className="p-4">{customer.salespersonName ?? "-"}</td>
                  <td className="p-4">{customer.phone}</td>
                  <td className="p-4">{customer.creditLimit ?? "-"}</td>
                  <td className="p-4">{customer.active ? "Active" : "Inactive"}</td>
                  <td className="p-4">
                    {canManage && (
                      <SalesStatusForm
                        action={setCustomerStatusAction}
                        id={customer.id}
                        active={customer.active}
                      />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <SearchPagination
          route="/sales/customers"
          query={query}
          page={result.page}
          pageCount={result.pageCount}
          total={result.total}
          filters={{
            customerGroupId: params.customerGroupId,
            areaId: params.areaId,
            salespersonId: params.salespersonId,
            status: params.status,
          }}
        />
      </Card>
    </ResponsiveContainer>
  );
}
function CustomerFilters({
  query,
  params,
  references,
}: {
  query: string;
  params: { customerGroupId?: string; areaId?: string; salespersonId?: string; status?: string };
  references: Awaited<ReturnType<PrismaSalesRepository["getReferenceData"]>>;
}) {
  return (
    <form action="/sales/customers" className="mb-4 grid gap-2 md:grid-cols-2 xl:grid-cols-5">
      <input
        className="min-h-11 rounded-lg border border-[var(--border)] px-3"
        defaultValue={query}
        name="q"
        placeholder="Code, name, or phone"
      />
      <Filter
        name="customerGroupId"
        value={params.customerGroupId}
        label="All groups"
        options={references.groups}
      />
      <Filter name="areaId" value={params.areaId} label="All areas" options={references.areas} />
      <Filter
        name="salespersonId"
        value={params.salespersonId}
        label="All salespersons"
        options={references.salespersons}
      />
      <select
        className="min-h-11 rounded-lg border border-[var(--border)] px-3"
        defaultValue={params.status ?? ""}
        name="status"
      >
        <option value="">All statuses</option>
        <option value="active">Active</option>
        <option value="inactive">Inactive</option>
      </select>
      <button
        className="min-h-11 rounded-lg bg-[var(--accent)] px-4 text-sm font-semibold text-white"
        type="submit"
      >
        Filter
      </button>
    </form>
  );
}
function Filter({
  name,
  value,
  label,
  options,
}: {
  name: string;
  value: string | undefined;
  label: string;
  options: readonly { id: string; name: string }[];
}) {
  return (
    <select
      className="min-h-11 rounded-lg border border-[var(--border)] px-3"
      defaultValue={value ?? ""}
      name={name}
    >
      <option value="">{label}</option>
      {options.map((option) => (
        <option key={option.id} value={option.id}>
          {option.name}
        </option>
      ))}
    </select>
  );
}
