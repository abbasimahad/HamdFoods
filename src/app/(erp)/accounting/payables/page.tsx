import Link from "next/link";
import { PageHeader } from "@/components/layout/page-header";
import { SubledgerList } from "@/components/accounting/subledger-workbench";
import { ResponsiveContainer } from "@/components/ui/responsive-container";
import { requirePermission } from "@/server/auth/server-guards";
import { PrismaSubledgerWorkbench } from "@/server/accounting/prisma-subledger-workbench";

export default async function PayablesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string; asOf?: string }>;
}) {
  await requirePermission("accounting.view");
  const params = await searchParams;
  const asOf = parseDate(params.asOf);
  const result = await new PrismaSubledgerWorkbench().listPayables({
    asOf,
    query: params.q ?? "",
    page: Number.parseInt(params.page ?? "1", 10) || 1,
  });
  return (
    <ResponsiveContainer>
      <PageHeader
        title="Payables"
        description="Source-derived supplier balances, aging, source documents, payments, and allocations."
      />
      <form className="mb-4 flex flex-wrap gap-2">
        <input
          className="min-h-11 rounded-lg border px-3"
          defaultValue={params.q}
          name="q"
          placeholder="Search suppliers"
        />
        <input
          className="min-h-11 rounded-lg border px-3"
          defaultValue={asOf.toISOString().slice(0, 10)}
          name="asOf"
          type="date"
        />
        <button className="rounded-lg border px-4">Search</button>
      </form>
      <SubledgerList basePath="/accounting/payables" rows={result.records} />
      <div className="mt-4 flex gap-3">
        {result.page > 1 ? (
          <Link
            href={`/accounting/payables?q=${encodeURIComponent(params.q ?? "")}&asOf=${params.asOf ?? ""}&page=${result.page - 1}`}
          >
            Previous
          </Link>
        ) : null}
        <span>
          Page {result.page} of {result.pageCount}
        </span>
        {result.page < result.pageCount ? (
          <Link
            href={`/accounting/payables?q=${encodeURIComponent(params.q ?? "")}&asOf=${params.asOf ?? ""}&page=${result.page + 1}`}
          >
            Next
          </Link>
        ) : null}
      </div>
    </ResponsiveContainer>
  );
}
function parseDate(value?: string) {
  const parsed = value ? new Date(`${value}T23:59:59.999Z`) : new Date();
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}
