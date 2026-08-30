import Link from "next/link";
import { PageHeader } from "@/components/layout/page-header";
import { ResponsiveContainer } from "@/components/ui/responsive-container";
import { Card } from "@/components/ui/card";
import { requirePermission } from "@/server/auth/server-guards";
import { journalPage } from "@/server/accounting/prisma-accounting-repository";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    status?: string;
    accountId?: string;
    sourceType?: string;
    from?: string;
    to?: string;
    page?: string;
  }>;
}) {
  await requirePermission("accounting.view");
  const params = await searchParams;
  const result = await journalPage(params);
  return (
    <ResponsiveContainer>
      <PageHeader
        title="Journal Browser"
        description="Immutable posted journals remain linked to their operational source."
      />
      <Card className="mb-4 p-4">
        <form className="grid gap-2 md:grid-cols-4">
          <input
            className="rounded border px-3 py-2"
            name="q"
            placeholder="Journal or source"
            defaultValue={params.q ?? ""}
          />
          <select
            className="rounded border px-3 py-2"
            defaultValue={params.status ?? ""}
            name="status"
          >
            <option value="">All statuses</option>
            <option value="DRAFT">Draft</option>
            <option value="POSTED">Posted</option>
            <option value="REVERSED">Reversed</option>
          </select>
          <select
            className="rounded border px-3 py-2"
            defaultValue={params.sourceType ?? ""}
            name="sourceType"
          >
            <option value="">All sources</option>
            {result.sourceTypes.map((sourceType) => (
              <option key={sourceType} value={sourceType}>
                {sourceType}
              </option>
            ))}
          </select>
          <select
            className="rounded border px-3 py-2"
            defaultValue={params.accountId ?? ""}
            name="accountId"
          >
            <option value="">All accounts</option>
            {result.accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.code} — {account.name}
              </option>
            ))}
          </select>
          <input
            className="rounded border px-3 py-2"
            defaultValue={params.from ?? ""}
            name="from"
            type="date"
          />
          <input
            className="rounded border px-3 py-2"
            defaultValue={params.to ?? ""}
            name="to"
            type="date"
          />
          <button className="rounded bg-[var(--accent)] px-3 py-2 text-white">Search</button>
        </form>
      </Card>
      <Card className="overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr>
              <th className="p-3 text-left">Journal</th>
              <th className="p-3 text-left">Date</th>
              <th className="p-3 text-left">Source</th>
              <th className="p-3 text-left">Debit / Credit</th>
              <th className="p-3 text-left">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {result.journals.map((journal) => (
              <tr key={journal.id}>
                <td className="p-3">
                  <Link
                    className="text-[var(--accent)]"
                    href={`/accounting/journals/${journal.id}`}
                  >
                    {journal.journalNumber}
                  </Link>
                </td>
                <td className="p-3">{journal.accountingDate.toISOString().slice(0, 10)}</td>
                <td className="p-3">
                  {journal.sourceType} {journal.sourceNumber ?? ""}
                </td>
                <td className="p-3">
                  {journal.totalDebit.toString()} / {journal.totalCredit.toString()}
                </td>
                <td className="p-3">{journal.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      <div className="mt-4 flex items-center justify-between text-sm">
        <span>{result.total} journals</span>
        <div className="flex gap-3">
          {result.page > 1 ? (
            <a className="text-[var(--accent)]" href={journalHref(params, result.page - 1)}>
              Previous
            </a>
          ) : null}
          {result.page * result.pageSize < result.total ? (
            <a className="text-[var(--accent)]" href={journalHref(params, result.page + 1)}>
              Next
            </a>
          ) : null}
        </div>
      </div>
    </ResponsiveContainer>
  );
}

function journalHref(params: Record<string, string | undefined>, page: number) {
  const query = new URLSearchParams(
    Object.entries({ ...params, page: String(page) }).filter(([, value]) => Boolean(value)) as [
      string,
      string,
    ][],
  );
  return `/accounting/journals?${query.toString()}`;
}
