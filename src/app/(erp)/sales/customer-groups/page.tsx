import { PageHeader } from "@/components/layout/page-header";
import { Card } from "@/components/ui/card";
import { ResponsiveContainer } from "@/components/ui/responsive-container";
import { MasterSearch, SearchPagination } from "@/components/master-data/search-pagination";
import { SalesMasterForm } from "@/components/sales/sales-master-form";
import { SalesStatusForm } from "@/components/sales/sales-status-form";
import { hasPermission } from "@/modules/access/domain/principal";
import { parseSalesPage } from "@/modules/sales/application/listing";
import { requirePermission } from "@/server/auth/server-guards";
import { PrismaSalesRepository } from "@/server/sales/prisma-sales-repository";
import { saveCustomerGroupAction, setCustomerGroupStatusAction } from "../actions";
export default async function CustomerGroupsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string; edit?: string }>;
}) {
  const principal = await requirePermission("sales.view");
  const params = await searchParams;
  const q = params.q?.trim().slice(0, 100) ?? "";
  const repository = new PrismaSalesRepository();
  const [result, selected] = await Promise.all([
    repository.listCustomerGroups(q, parseSalesPage(params.page)),
    params.edit ? repository.getCustomerGroup(params.edit) : null,
  ]);
  const canManage = hasPermission(principal, "sales.manage");
  return (
    <ResponsiveContainer>
      <PageHeader
        title="Customer Groups"
        description="Classify customers without introducing group pricing."
      />
      {canManage && (
        <Card className="mb-5 p-5">
          <details open={Boolean(selected)}>
            <summary className="cursor-pointer font-semibold">
              {selected ? `Edit ${selected.name}` : "Create customer group"}
            </summary>
            <div className="mt-4">
              <SalesMasterForm
                action={saveCustomerGroupAction}
                initial={selected ?? undefined}
                kind="group"
              />
            </div>
          </details>
        </Card>
      )}
      <MasterSearch route="/sales/customer-groups" defaultValue={q} />
      <MasterTable
        records={result.records}
        canManage={canManage}
        action={setCustomerGroupStatusAction}
      />
      <SearchPagination
        route="/sales/customer-groups"
        query={q}
        page={result.page}
        pageCount={result.pageCount}
        total={result.total}
      />
    </ResponsiveContainer>
  );
}
function MasterTable({
  records,
  canManage,
  action,
}: {
  records: Awaited<ReturnType<PrismaSalesRepository["listCustomerGroups"]>>["records"];
  canManage: boolean;
  action: typeof setCustomerGroupStatusAction;
}) {
  return (
    <Card className="overflow-hidden">
      <table className="w-full text-left text-sm">
        <thead className="bg-[var(--surface)]">
          <tr>
            <th className="p-4">Code</th>
            <th className="p-4">Name</th>
            <th className="p-4">Description</th>
            <th className="p-4">Status</th>
            <th className="p-4">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--border)]">
          {records.map((record) => (
            <tr key={record.id}>
              <td className="p-4 font-mono text-xs">{record.code}</td>
              <td className="p-4 font-semibold">{record.name}</td>
              <td className="p-4">{record.description ?? "-"}</td>
              <td className="p-4">{record.active ? "Active" : "Inactive"}</td>
              <td className="p-4">
                {canManage && (
                  <div className="flex gap-3">
                    <Link
                      className="text-xs font-semibold text-[var(--accent)]"
                      href={`/sales/customer-groups?edit=${record.id}`}
                    >
                      Edit
                    </Link>
                    <SalesStatusForm action={action} id={record.id} active={record.active} />
                  </div>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}
import Link from "next/link";
