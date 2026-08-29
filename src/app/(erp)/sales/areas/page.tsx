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
import { saveAreaAction, setAreaStatusAction } from "../actions";
export default async function AreasPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string; edit?: string }>;
}) {
  const principal = await requirePermission("sales.view");
  const params = await searchParams;
  const q = params.q?.trim().slice(0, 100) ?? "";
  const repository = new PrismaSalesRepository();
  const [result, selected] = await Promise.all([
    repository.listAreas(q, parseSalesPage(params.page)),
    params.edit ? repository.getArea(params.edit) : null,
  ]);
  const canManage = hasPermission(principal, "sales.manage");
  return (
    <ResponsiveContainer>
      <PageHeader
        title="Sales Areas"
        description="Maintain sales territories; referenced areas are retained historically."
      />
      {canManage && (
        <Card className="mb-5 p-5">
          <details open={Boolean(selected)}>
            <summary className="cursor-pointer font-semibold">
              {selected ? `Edit ${selected.name}` : "Create sales area"}
            </summary>
            <div className="mt-4">
              <SalesMasterForm
                action={saveAreaAction}
                initial={selected ?? undefined}
                kind="area"
              />
            </div>
          </details>
        </Card>
      )}
      <MasterSearch route="/sales/areas" defaultValue={q} />
      <Card className="overflow-hidden">
        <table className="w-full text-left text-sm">
          <thead className="bg-[var(--surface)]">
            <tr>
              <th className="p-4">Code</th>
              <th className="p-4">Area</th>
              <th className="p-4">Routes</th>
              <th className="p-4">Status</th>
              <th className="p-4">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border)]">
            {result.records.map((area) => (
              <tr key={area.id}>
                <td className="p-4 font-mono text-xs">{area.code}</td>
                <td className="p-4">
                  <span className="font-semibold">{area.name}</span>
                  {area.description && (
                    <span className="block text-xs text-[var(--muted)]">{area.description}</span>
                  )}
                </td>
                <td className="p-4">{area.routeCount}</td>
                <td className="p-4">{area.active ? "Active" : "Inactive"}</td>
                <td className="p-4">
                  {canManage && (
                    <div className="flex gap-3">
                      <Link
                        className="text-xs font-semibold text-[var(--accent)]"
                        href={`/sales/areas?edit=${area.id}`}
                      >
                        Edit
                      </Link>
                      <SalesStatusForm
                        action={setAreaStatusAction}
                        id={area.id}
                        active={area.active}
                      />
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      <SearchPagination
        route="/sales/areas"
        query={q}
        page={result.page}
        pageCount={result.pageCount}
        total={result.total}
      />
    </ResponsiveContainer>
  );
}
import Link from "next/link";
