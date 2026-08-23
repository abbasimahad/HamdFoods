import { CategoryForm } from "@/components/master-data/category-form";
import { MasterStatusForm } from "@/components/master-data/master-status-form";
import { MasterSearch, SearchPagination } from "@/components/master-data/search-pagination";
import { PageHeader } from "@/components/layout/page-header";
import { Card } from "@/components/ui/card";
import { ResponsiveContainer } from "@/components/ui/responsive-container";
import { hasPermission } from "@/modules/access/domain/principal";
import { parseListQuery } from "@/modules/master-data/application/listing";
import { PrismaMasterDataRepository } from "@/server/master-data/prisma-master-data-repository";
import { requirePermission } from "@/server/auth/server-guards";

import { saveCategoryAction, setCategoryStatusAction } from "./actions";

export default async function CategoriesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string }>;
}) {
  const principal = await requirePermission("inventory.view");
  const query = parseListQuery(await searchParams);
  const result = await new PrismaMasterDataRepository().listCategories(query);
  const canManage = hasPermission(principal, "inventory.manage");
  return (
    <ResponsiveContainer>
      <PageHeader
        title="Item Categories"
        description="Maintain type-specific categories used by the unified item master."
      />
      {canManage && (
        <Card className="mb-5 p-5">
          <h2 className="mb-4 font-semibold">Create category</h2>
          <CategoryForm action={saveCategoryAction} />
        </Card>
      )}
      <MasterSearch defaultValue={query.query} route="/inventory/categories" />
      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[54rem] text-left text-sm">
            <thead className="bg-[var(--surface)]">
              <tr>
                <th className="p-4">Code</th>
                <th className="p-4">Name</th>
                <th className="p-4">Item type</th>
                <th className="p-4">Description</th>
                <th className="p-4">Status</th>
                <th className="p-4">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {result.records.map((category) => (
                <tr key={category.id}>
                  <td className="p-4 font-mono text-xs">{category.code}</td>
                  <td className="p-4 font-medium">{category.name}</td>
                  <td className="p-4 text-xs">{category.itemType}</td>
                  <td className="max-w-64 truncate p-4 text-[var(--muted)]">
                    {category.description || "—"}
                  </td>
                  <td className="p-4">{category.active ? "Active" : "Inactive"}</td>
                  <td className="p-4">
                    {canManage && (
                      <div className="space-y-2">
                        <details>
                          <summary className="cursor-pointer text-xs font-semibold">Edit</summary>
                          <div className="mt-3 w-[48rem] max-w-[80vw]">
                            <CategoryForm action={saveCategoryAction} initial={category} />
                          </div>
                        </details>
                        <MasterStatusForm
                          action={setCategoryStatusAction}
                          active={category.active}
                          id={category.id}
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
          query={query.query}
          route="/inventory/categories"
          total={result.total}
        />
      </Card>
    </ResponsiveContainer>
  );
}
