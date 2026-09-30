import Decimal from "decimal.js";
import { Card } from "@/components/ui/card";
import { formatMoney } from "@/components/ui/format-money";
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
  // UX-9: a trial balance lists each account's net balance on its debit or credit side, not the
  // gross debit and credit turnover.
  const rows = report.rows.map((row) => {
    const net = row.debit.sub(row.credit);
    return {
      account: row.account,
      debit: net.gt(0) ? net : null,
      credit: net.lt(0) ? net.negated() : null,
    };
  });
  const totalDebit = rows.reduce((sum, row) => sum.add(row.debit ?? 0), new Decimal(0));
  const totalCredit = rows.reduce((sum, row) => sum.add(row.credit ?? 0), new Decimal(0));
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
              <th className="p-3 text-right">Debit</th>
              <th className="p-3 text-right">Credit</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.map((row) => (
              <tr key={row.account.id}>
                <td className="p-3">
                  {row.account.code} — {row.account.name}
                </td>
                <td className="p-3 text-right">{row.debit ? formatMoney(row.debit, "") : ""}</td>
                <td className="p-3 text-right">{row.credit ? formatMoney(row.credit, "") : ""}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="font-semibold">
              <td className="p-3">Total</td>
              <td className="p-3 text-right">{formatMoney(totalDebit, "")}</td>
              <td className="p-3 text-right">{formatMoney(totalCredit, "")}</td>
            </tr>
          </tfoot>
        </table>
      </Card>
    </ResponsiveContainer>
  );
}
