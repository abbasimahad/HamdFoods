import { PageHeader } from "@/components/layout/page-header";
import { Card } from "@/components/ui/card";
import { ResponsiveContainer } from "@/components/ui/responsive-container";
import { MasterSearch, SearchPagination } from "@/components/master-data/search-pagination";
import { SalespersonForm } from "@/components/sales/salesperson-form";
import { SalesStatusForm } from "@/components/sales/sales-status-form";
import { hasPermission } from "@/modules/access/domain/principal";
import { parseSalesPage } from "@/modules/sales/application/listing";
import { requirePermission } from "@/server/auth/server-guards";
import { PrismaSalesRepository } from "@/server/sales/prisma-sales-repository";
import { saveSalespersonAction, setSalespersonStatusAction } from "../actions";
export default async function SalespersonsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string; edit?: string }>;
}) {
  const principal = await requirePermission("sales.view");
  const params = await searchParams;
  const q = params.q?.trim().slice(0, 100) ?? "";
  const repository = new PrismaSalesRepository();
  const [result, references, selected] = await Promise.all([
    repository.listSalespersons(q, parseSalesPage(params.page)),
    repository.getReferenceData(Boolean(!params.edit)),
    params.edit ? repository.getSalesperson(params.edit) : null,
  ]);
  const canManage = hasPermission(principal, "sales.manage");
  return (
    <ResponsiveContainer>
      <PageHeader
        title="Salespersons"
        description="Business master records optionally linked to ERP users; authentication remains separate."
      />
      {canManage && (
        <Card className="mb-5 p-5">
          <details open={Boolean(selected)}>
            <summary className="cursor-pointer font-semibold">
              {selected ? `Edit ${selected.name}` : "Create salesperson"}
            </summary>
            <div className="mt-4">
              <SalespersonForm
                action={saveSalespersonAction}
                initial={selected ?? undefined}
                references={references}
              />
            </div>
          </details>
        </Card>
      )}
      <MasterSearch route="/sales/salespersons" defaultValue={q} />
      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[65rem] text-left text-sm">
            <thead className="bg-[var(--surface)]">
              <tr>
                <th className="p-4">Code</th>
                <th className="p-4">Name</th>
                <th className="p-4">Phone</th>
                <th className="p-4">Linked ERP user</th>
                <th className="p-4">Areas / routes</th>
                <th className="p-4">Status</th>
                <th className="p-4">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {result.records.map((person) => (
                <tr key={person.id}>
                  <td className="p-4 font-mono text-xs">{person.code}</td>
                  <td className="p-4 font-semibold">{person.name}</td>
                  <td className="p-4">{person.phone ?? "-"}</td>
                  <td className="p-4">{person.linkedUserName ?? "-"}</td>
                  <td className="p-4 text-xs">{person.assignmentSummary}</td>
                  <td className="p-4">{person.active ? "Active" : "Inactive"}</td>
                  <td className="p-4">
                    {canManage && (
                      <div className="flex gap-3">
                        <Link
                          className="text-xs font-semibold text-[var(--accent)]"
                          href={`/sales/salespersons?edit=${person.id}`}
                        >
                          Edit
                        </Link>
                        <SalesStatusForm
                          action={setSalespersonStatusAction}
                          id={person.id}
                          active={person.active}
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
          route="/sales/salespersons"
          query={q}
          page={result.page}
          pageCount={result.pageCount}
          total={result.total}
        />
      </Card>
    </ResponsiveContainer>
  );
}
import Link from "next/link";
