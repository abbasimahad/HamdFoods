import Link from "next/link";

import { PageHeader } from "@/components/layout/page-header";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ResponsiveContainer } from "@/components/ui/responsive-container";
import { StatusBadge } from "@/components/ui/status-badge";
import { hasPermission } from "@/modules/access/domain/principal";
import { requireAnyPermission } from "@/server/auth/server-guards";
import { PrismaReprocessRepository } from "@/server/production/prisma-reprocess-repository";

export default async function ReprocessPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string }>;
}) {
  const principal = await requireAnyPermission(["production.view", "quality.manage"]);
  const filters = await searchParams;
  const query = filters.q?.trim().toLocaleLowerCase() ?? "";
  const records = (await new PrismaReprocessRepository().listDocuments()).filter(
    (record) =>
      (!filters.status || record.status === filters.status) &&
      (!query ||
        [
          record.documentNumber,
          record.finishedGood.code,
          record.finishedGood.name,
          record.linkedProductionBatch.batchNumber,
          record.childProductionLot?.lotNumber ?? "",
        ].some((value) => value.toLocaleLowerCase().includes(query))),
  );
  return (
    <ResponsiveContainer>
      <PageHeader
        title="Reprocess"
        description="Trace source finished goods through controlled WIP, a new child lot, costing, and independent quality release."
        actions={
          hasPermission(principal, "production.manage") ? (
            <Link
              className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white"
              href="/production/reprocess/new"
            >
              New Reprocess
            </Link>
          ) : undefined
        }
      />
      <Card className="mb-5 p-4">
        <form className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_14rem_auto_auto]" method="get">
          <label className="text-sm font-medium">
            Search documents and lots
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
              {[
                "DRAFT",
                "RESERVED",
                "IN_PROGRESS",
                "AWAITING_QC",
                "RELEASED",
                "REJECTED",
                "CANCELLED",
              ].map((status) => (
                <option key={status}>{status}</option>
              ))}
            </select>
          </label>
          <button className="min-h-11 self-end rounded-lg bg-[var(--accent)] px-4 font-semibold text-white">
            Apply
          </button>
          <Link
            className="inline-flex min-h-11 items-center justify-center self-end rounded-lg border border-[var(--control-border)] px-4 font-semibold"
            href="/production/reprocess"
          >
            Clear
          </Link>
        </form>
      </Card>
      {records.length === 0 ? (
        <EmptyState
          title="No Reprocess documents"
          description="Authorized production users can create a draft after Waste & Damage places an eligible finished-good lot in REPROCESS custody."
        />
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[66rem] text-left text-sm">
              <thead className="bg-[var(--surface)]">
                <tr>
                  <th className="p-4">Document</th>
                  <th className="p-4">Finished good</th>
                  <th className="p-4">Source custody</th>
                  <th className="p-4">Linked batch</th>
                  <th className="p-4">Child lot</th>
                  <th className="p-4">Status</th>
                  <th className="p-4">Date</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {records.map((record) => (
                  <tr key={record.id}>
                    <td className="p-4">
                      <Link
                        className="font-mono font-semibold text-[var(--accent)]"
                        href={`/production/reprocess/${record.id}`}
                      >
                        {record.documentNumber}
                      </Link>
                    </td>
                    <td className="p-4">
                      {record.finishedGood.code} · {record.finishedGood.name}
                    </td>
                    <td className="p-4">{record.sourceWarehouse.code} · REPROCESS</td>
                    <td className="p-4 font-mono">{record.linkedProductionBatch.batchNumber}</td>
                    <td className="p-4 font-mono">
                      {record.childProductionLot?.lotNumber ?? "Pending"}
                    </td>
                    <td className="p-4">
                      <StatusBadge
                        tone={
                          record.status === "RELEASED"
                            ? "positive"
                            : record.status === "REJECTED" || record.status === "CANCELLED"
                              ? "warning"
                              : "info"
                        }
                      >
                        {record.status}
                      </StatusBadge>
                    </td>
                    <td className="p-4">{record.documentDate.toLocaleDateString()}</td>
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
