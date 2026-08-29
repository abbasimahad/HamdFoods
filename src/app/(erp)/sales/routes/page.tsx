import { PageHeader } from "@/components/layout/page-header";
import { Card } from "@/components/ui/card";
import { ResponsiveContainer } from "@/components/ui/responsive-container";
import { SearchPagination } from "@/components/master-data/search-pagination";
import { SalesMasterForm } from "@/components/sales/sales-master-form";
import { SalesStatusForm } from "@/components/sales/sales-status-form";
import { hasPermission } from "@/modules/access/domain/principal";
import { parseSalesPage } from "@/modules/sales/application/listing";
import { requirePermission } from "@/server/auth/server-guards";
import { PrismaSalesRepository } from "@/server/sales/prisma-sales-repository";
import { saveRouteAction, setRouteStatusAction } from "../actions";
export default async function RoutesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string; areaId?: string; edit?: string }>;
}) {
  const principal = await requirePermission("sales.view");
  const params = await searchParams;
  const q = params.q?.trim().slice(0, 100) ?? "";
  const repository = new PrismaSalesRepository();
  const [result, references, selected] = await Promise.all([
    repository.listRoutes(q, parseSalesPage(params.page), params.areaId),
    repository.getReferenceData(Boolean(!params.edit)),
    params.edit ? repository.getRoute(params.edit) : null,
  ]);
  const canManage = hasPermission(principal, "sales.manage");
  return (
    <ResponsiveContainer>
      <PageHeader
        title="Sales Routes"
        description="Routes belong to one sales area and are retained for historical customers."
      />
      {canManage && (
        <Card className="mb-5 p-5">
          <details open={Boolean(selected)}>
            <summary className="cursor-pointer font-semibold">
              {selected ? `Edit ${selected.name}` : "Create sales route"}
            </summary>
            <div className="mt-4">
              <SalesMasterForm
                action={saveRouteAction}
                initial={selected ?? undefined}
                kind="route"
                areas={references.areas}
              />
            </div>
          </details>
        </Card>
      )}
      <form action="/sales/routes" className="mb-4 flex flex-wrap gap-2">
        <input
          className="min-h-11 flex-1 rounded-lg border border-[var(--border)] px-3"
          defaultValue={q}
          name="q"
          placeholder="Search by code or name"
        />
        <select
          className="min-h-11 rounded-lg border border-[var(--border)] px-3"
          defaultValue={params.areaId ?? ""}
          name="areaId"
        >
          <option value="">All areas</option>
          {references.areas.map((area) => (
            <option key={area.id} value={area.id}>
              {area.name}
            </option>
          ))}
        </select>
        <button
          className="min-h-11 rounded-lg bg-[var(--accent)] px-4 text-sm font-semibold text-white"
          type="submit"
        >
          Filter
        </button>
      </form>
      <Card className="overflow-hidden">
        <table className="w-full text-left text-sm">
          <thead className="bg-[var(--surface)]">
            <tr>
              <th className="p-4">Code</th>
              <th className="p-4">Route</th>
              <th className="p-4">Area</th>
              <th className="p-4">Status</th>
              <th className="p-4">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border)]">
            {result.records.map((route) => (
              <tr key={route.id}>
                <td className="p-4 font-mono text-xs">{route.code}</td>
                <td className="p-4">
                  <span className="font-semibold">{route.name}</span>
                  {route.description && (
                    <span className="block text-xs text-[var(--muted)]">{route.description}</span>
                  )}
                </td>
                <td className="p-4">{route.areaName}</td>
                <td className="p-4">{route.active ? "Active" : "Inactive"}</td>
                <td className="p-4">
                  {canManage && (
                    <div className="flex gap-3">
                      <Link
                        className="text-xs font-semibold text-[var(--accent)]"
                        href={`/sales/routes?edit=${route.id}`}
                      >
                        Edit
                      </Link>
                      <SalesStatusForm
                        action={setRouteStatusAction}
                        id={route.id}
                        active={route.active}
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
        route="/sales/routes"
        query={q}
        page={result.page}
        pageCount={result.pageCount}
        total={result.total}
        filters={{ areaId: params.areaId }}
      />
    </ResponsiveContainer>
  );
}
import Link from "next/link";
