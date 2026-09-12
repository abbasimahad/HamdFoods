import Link from "next/link";
import { PageHeader } from "@/components/layout/page-header";
import { TransactionWorkbenchList } from "@/components/production/transaction-workbench-list";
import { PageActions, primaryPageActionClass } from "@/components/ui/page-actions";
import { ResponsiveContainer } from "@/components/ui/responsive-container";
import { hasPermission } from "@/modules/access/domain/principal";
import { requirePermission } from "@/server/auth/server-guards";
import { PrismaProductionTransactionWorkbench } from "@/server/production/prisma-production-transaction-workbench";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; type?: string; status?: string; page?: string }>;
}) {
  const principal = await requirePermission("production.view");
  const q = await searchParams;
  const data = await new PrismaProductionTransactionWorkbench().list("material", {
    query: q.q ?? "",
    type: q.type,
    status: q.status,
    page: Number(q.page) || 1,
  });
  return (
    <ResponsiveContainer>
      <PageHeader
        title="Material Issues"
        description="Direct access to existing batch material issue, return, and consumption transactions."
        actions={
          hasPermission(principal, "production.manage") ? (
            <PageActions>
              <Link className={primaryPageActionClass} href="/production/material-issues/new">
                + New Material Issue
              </Link>
            </PageActions>
          ) : null
        }
      />
      <Filters q={q} />
      <TransactionWorkbenchList base="/production/material-issues" rows={data.records} />
    </ResponsiveContainer>
  );
}
function Filters({ q }: { q: { q?: string; type?: string; status?: string } }) {
  return (
    <form className="mb-4 flex flex-wrap gap-2">
      <input
        className="min-h-11 rounded border px-3"
        defaultValue={q.q}
        name="q"
        placeholder="Search transaction or batch"
      />
      <select className="min-h-11 rounded border px-3" defaultValue={q.type ?? ""} name="type">
        <option value="">All types</option>
        <option>ISSUE</option>
        <option>RETURN</option>
        <option>CONSUMPTION</option>
      </select>
      <select className="min-h-11 rounded border px-3" defaultValue={q.status ?? ""} name="status">
        <option value="">All statuses</option>
        <option>DRAFT</option>
        <option>POSTED</option>
        <option>CANCELLED</option>
      </select>
      <button className="rounded border px-4">Filter</button>
    </form>
  );
}
