import Link from "next/link";

import { PageHeader } from "@/components/layout/page-header";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ResponsiveContainer } from "@/components/ui/responsive-container";
import { StatusBadge } from "@/components/ui/status-badge";
import { hasPermission } from "@/modules/access/domain/principal";
import { requirePermission } from "@/server/auth/server-guards";
import { PrismaWasteDispositionRepository } from "@/server/inventory/prisma-waste-disposition-repository";

export default async function WasteDamagePage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string }>;
}) {
  const principal = await requirePermission("inventory.view");
  const filters = await searchParams;
  const query = filters.q?.trim().toLocaleLowerCase() ?? "";
  const records = (await new PrismaWasteDispositionRepository().listDocuments()).filter(
    (record) =>
      (!filters.status || record.status === filters.status) &&
      (!query ||
        [record.documentNumber, record.warehouse.code, record.createdBy.name].some((value) =>
          value.toLocaleLowerCase().includes(query),
        )),
  );
  return (
    <ResponsiveContainer>
      <PageHeader
        title="Waste & Damage"
        description="Move identified damaged, quarantined, or scrap inventory through controlled disposition without bypassing inventory value or lot history."
        actions={
          hasPermission(principal, "inventory.manage") ? (
            <Link
              className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white"
              href="/production/waste-damage/new"
            >
              New disposition
            </Link>
          ) : undefined
        }
      />
      <Card className="mb-5 p-4">
        <form className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_14rem_auto_auto]" method="get">
          <label className="text-sm font-medium">
            Search documents and warehouses
            <input
              className="mt-1 min-h-11 w-full rounded-lg border border-[var(--control-border)] px-3"
              defaultValue={filters.q}
              name="q"
            />
          </label>
          <label className="text-sm font-medium">
            Status
            <select
              className="mt-1 min-h-11 w-full rounded-lg border border-[var(--control-border)] bg-white px-3"
              defaultValue={filters.status ?? ""}
              name="status"
            >
              <option value="">All statuses</option>
              {["DRAFT", "POSTED", "CANCELLED", "REVERSED"].map((status) => (
                <option key={status}>{status}</option>
              ))}
            </select>
          </label>
          <button className="min-h-11 self-end rounded-lg bg-[var(--accent)] px-4 font-semibold text-white">
            Apply
          </button>
          <Link
            className="inline-flex min-h-11 items-center justify-center self-end rounded-lg border border-[var(--control-border)] px-4 font-semibold"
            href="/production/waste-damage"
          >
            Clear
          </Link>
        </form>
      </Card>
      {records.length === 0 ? (
        <EmptyState
          title="No disposition documents"
          description="Authorized inventory controllers can save a draft for damaged, quarantined, or scrap lot custody."
        />
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[62rem] text-left text-sm">
              <thead className="bg-[var(--surface)]">
                <tr>
                  <th className="p-4">Document</th>
                  <th className="p-4">Date</th>
                  <th className="p-4">Warehouse</th>
                  <th className="p-4">Actions</th>
                  <th className="p-4">Lines</th>
                  <th className="p-4">Status</th>
                  <th className="p-4">Created by</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {records.map((record) => (
                  <tr key={record.id}>
                    <td className="p-4">
                      <Link
                        className="font-mono font-semibold text-[var(--accent)]"
                        href={`/production/waste-damage/${record.id}`}
                      >
                        {record.documentNumber}
                      </Link>
                    </td>
                    <td className="p-4">{record.dispositionDate.toLocaleDateString()}</td>
                    <td className="p-4">{record.warehouse.code}</td>
                    <td className="p-4">
                      {[...new Set(record.lines.map((line) => line.action))].join(", ")}
                    </td>
                    <td className="p-4">{record.lines.length}</td>
                    <td className="p-4">
                      <StatusBadge
                        tone={
                          record.status === "POSTED"
                            ? "positive"
                            : record.status === "CANCELLED" || record.status === "REVERSED"
                              ? "warning"
                              : "info"
                        }
                      >
                        {record.status}
                      </StatusBadge>
                    </td>
                    <td className="p-4">{record.createdBy.name}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </ResponsiveContainer>
  );
}
