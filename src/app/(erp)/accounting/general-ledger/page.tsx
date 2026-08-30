import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/layout/page-header";
import { ResponsiveContainer } from "@/components/ui/responsive-container";
import { requirePermission } from "@/server/auth/server-guards";
import { generalLedger } from "@/server/accounting/prisma-accounting-repository";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ accountId?: string; from?: string; to?: string }>;
}) {
  await requirePermission("accounting.view");
  const params = await searchParams;
  const result = await generalLedger(params.accountId, params.from, params.to);
  return (
    <ResponsiveContainer>
      <PageHeader
        title="General Ledger"
        description="Posted lines only; running balance is derived, never stored."
      />
      <Card className="mb-4 p-4">
        <form>
          <select
            className="rounded border px-3 py-2"
            name="accountId"
            defaultValue={result.selected}
          >
            {result.accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.code} — {account.name}
              </option>
            ))}
          </select>
          <input
            className="ml-2 rounded border px-3 py-2"
            defaultValue={params.from ?? ""}
            name="from"
            type="date"
          />
          <input
            className="ml-2 rounded border px-3 py-2"
            defaultValue={params.to ?? ""}
            name="to"
            type="date"
          />
          <button className="ml-2 rounded bg-[var(--accent)] px-3 py-2 text-white">View</button>
        </form>
      </Card>
      <Card className="overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr>
              <th className="p-3 text-left">Date</th>
              <th className="p-3 text-left">Journal</th>
              <th className="p-3 text-left">Debit</th>
              <th className="p-3 text-left">Credit</th>
              <th className="p-3 text-left">Balance</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {result.lines.map((line) => (
              <tr key={line.id}>
                <td className="p-3">{line.journal.accountingDate.toISOString().slice(0, 10)}</td>
                <td className="p-3">{line.journal.journalNumber}</td>
                <td className="p-3">{line.debit.toString()}</td>
                <td className="p-3">{line.credit.toString()}</td>
                <td className="p-3">{line.runningBalance}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </ResponsiveContainer>
  );
}
