import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/layout/page-header";
import { ResponsiveContainer } from "@/components/ui/responsive-container";
import { requirePermission } from "@/server/auth/server-guards";
import { trialBalance } from "@/server/accounting/prisma-accounting-repository";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  await requirePermission("accounting.view");
  const params = await searchParams;
  const report = await trialBalance(params.from, params.to);
  return (
    <ResponsiveContainer>
      <PageHeader
        title="Trial Balance"
        description="The total debit and credit balances must agree."
      />
      <Card className="mb-4 p-4">
        <form>
          <input
            className="rounded border px-3 py-2"
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
          <button className="ml-2 rounded bg-[var(--accent)] px-3 py-2 text-white">Apply</button>
        </form>
      </Card>
      <Card className="overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr>
              <th className="p-3 text-left">Account</th>
              <th className="p-3 text-left">Debit</th>
              <th className="p-3 text-left">Credit</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {report.rows.map((row) => (
              <tr key={row.account.id}>
                <td className="p-3">
                  {row.account.code} — {row.account.name}
                </td>
                <td className="p-3">{row.debit.toFixed(6)}</td>
                <td className="p-3">{row.credit.toFixed(6)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="font-semibold">
              <td className="p-3">Total</td>
              <td className="p-3">{report.totalDebit.toFixed(6)}</td>
              <td className="p-3">{report.totalCredit.toFixed(6)}</td>
            </tr>
          </tfoot>
        </table>
      </Card>
    </ResponsiveContainer>
  );
}
