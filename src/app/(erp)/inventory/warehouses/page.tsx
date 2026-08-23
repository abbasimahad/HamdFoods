import { WarehouseForm } from "@/components/inventory/warehouse-form";
import { WarehouseStatusForm } from "@/components/inventory/warehouse-status-form";
import { PageHeader } from "@/components/layout/page-header";
import { MasterSearch, SearchPagination } from "@/components/master-data/search-pagination";
import { Card } from "@/components/ui/card";
import { ResponsiveContainer } from "@/components/ui/responsive-container";
import { hasPermission } from "@/modules/access/domain/principal";
import { parseInventoryPage } from "@/modules/inventory/application/listing";
import { requirePermission } from "@/server/auth/server-guards";
import { PrismaInventoryRepository } from "@/server/inventory/prisma-inventory-repository";

import { saveWarehouseAction, setWarehouseStatusAction } from "./actions";

export default async function WarehousesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string }>;
}) {
  const principal = await requirePermission("inventory.view");
  const params = await searchParams;
  const query = params.q?.trim().slice(0, 120) ?? "";
  const page = parseInventoryPage(params.page);
  const result = await new PrismaInventoryRepository().listWarehouses(query, page);
  const canManage = hasPermission(principal, "inventory.manage");
  return (
    <ResponsiveContainer>
      <PageHeader
        title="Warehouses"
        description="Maintain warehouse-level stock locations without storing editable balances."
      />
      {canManage && (
        <Card className="mb-5 p-5">
          <h2 className="mb-4 font-semibold">Create warehouse</h2>
          <WarehouseForm action={saveWarehouseAction} />
        </Card>
      )}
      <MasterSearch defaultValue={query} route="/inventory/warehouses" />
      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[50rem] text-left text-sm">
            <thead className="bg-[var(--surface)]">
              <tr>
                <th className="p-4">Code</th>
                <th className="p-4">Warehouse</th>
                <th className="p-4">Description</th>
                <th className="p-4">Status</th>
                <th className="p-4">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {result.records.map((warehouse) => (
                <tr key={warehouse.id}>
                  <td className="p-4 font-mono text-xs">{warehouse.code}</td>
                  <td className="p-4 font-medium">{warehouse.name}</td>
                  <td className="p-4 text-[var(--muted)]">{warehouse.description ?? "—"}</td>
                  <td className="p-4">{warehouse.active ? "Active" : "Inactive"}</td>
                  <td className="p-4">
                    {canManage && (
                      <div className="space-y-2">
                        <details>
                          <summary className="cursor-pointer text-xs font-semibold">Edit</summary>
                          <div className="mt-3 w-[55rem] max-w-[80vw]">
                            <WarehouseForm action={saveWarehouseAction} initial={warehouse} />
                          </div>
                        </details>
                        <WarehouseStatusForm
                          action={setWarehouseStatusAction}
                          active={warehouse.active}
                          id={warehouse.id}
                        />
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <SearchPagination
          page={result.page}
          pageCount={result.pageCount}
          query={query}
          route="/inventory/warehouses"
          total={result.total}
        />
      </Card>
    </ResponsiveContainer>
  );
}
