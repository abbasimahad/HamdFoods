import { UnitForm } from "@/components/master-data/unit-form";
import { MasterStatusForm } from "@/components/master-data/master-status-form";
import { MasterSearch, SearchPagination } from "@/components/master-data/search-pagination";
import { PageHeader } from "@/components/layout/page-header";
import { Card } from "@/components/ui/card";
import { ResponsiveContainer } from "@/components/ui/responsive-container";
import { hasPermission } from "@/modules/access/domain/principal";
import { parseListQuery } from "@/modules/master-data/application/listing";
import { PrismaMasterDataRepository } from "@/server/master-data/prisma-master-data-repository";
import { requirePermission } from "@/server/auth/server-guards";

import { saveUnitAction, setUnitStatusAction } from "./actions";

export default async function UnitsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string }>;
}) {
  const principal = await requirePermission("inventory.view");
  const query = parseListQuery(await searchParams);
  const result = await new PrismaMasterDataRepository().listUnits(query);
  const canManage = hasPermission(principal, "inventory.manage");
  return (
    <ResponsiveContainer>
      <PageHeader
        title="Units of Measure"
        description="Maintain stock and content units. Conversion calculations remain deferred to Phase 5."
      />
      {canManage && (
        <Card className="mb-5 p-5">
          <h2 className="mb-4 font-semibold">Create unit</h2>
          <UnitForm action={saveUnitAction} />
        </Card>
      )}
      <MasterSearch defaultValue={query.query} route="/inventory/units" />
      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[48rem] text-left text-sm">
            <thead className="bg-[var(--surface)]">
              <tr>
                <th className="p-4">Code</th>
                <th className="p-4">Name</th>
                <th className="p-4">Symbol</th>
                <th className="p-4">Dimension</th>
                <th className="p-4">Status</th>
                <th className="p-4">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {result.records.map((unit) => (
                <tr key={unit.id}>
                  <td className="p-4 font-mono text-xs">{unit.code}</td>
                  <td className="p-4 font-medium">{unit.name}</td>
                  <td className="p-4">{unit.symbol}</td>
                  <td className="p-4">{unit.dimension}</td>
                  <td className="p-4">{unit.active ? "Active" : "Inactive"}</td>
                  <td className="p-4">
                    {canManage && (
                      <div className="space-y-2">
                        <details>
                          <summary className="cursor-pointer text-xs font-semibold">Edit</summary>
                          <div className="mt-3 w-[42rem] max-w-[80vw]">
                            <UnitForm action={saveUnitAction} initial={unit} />
                          </div>
                        </details>
                        <MasterStatusForm
                          action={setUnitStatusAction}
                          active={unit.active}
                          id={unit.id}
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
          route="/inventory/units"
          total={result.total}
        />
      </Card>
    </ResponsiveContainer>
  );
}
