import Link from "next/link";
import { TreasuryAccountForm } from "@/components/accounting/phase23-forms";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/layout/page-header";
import { ResponsiveContainer } from "@/components/ui/responsive-container";
import { hasPermission } from "@/modules/access/domain/principal";
import { requirePermission } from "@/server/auth/server-guards";
import { treasuryAccounts } from "@/server/accounting/prisma-phase23-repository";
import { prisma } from "@/server/db/prisma";
export default async function Page() {
  const principal = await requirePermission("accounting.view");
  const [treasuries, accounts] = await Promise.all([
    treasuryAccounts(),
    prisma.accountingAccount.findMany({
      where: { active: true, postingAllowed: true, accountType: "ASSET" },
      orderBy: { code: "asc" },
    }),
  ]);
  return (
    <ResponsiveContainer>
      <PageHeader
        title="Cash & Bank Accounts"
        description="Treasury balances are derived from posted General Ledger lines, not bank statements."
      />
      {hasPermission(principal, "accounting.manage") ? (
        <Card className="mb-4 p-4">
          <TreasuryAccountForm accounts={accounts} />
        </Card>
      ) : null}
      <Card className="overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr>
              <th className="p-3 text-left">Account</th>
              <th className="p-3 text-left">Type</th>
              <th className="p-3 text-left">Linked GL</th>
              <th className="p-3 text-left">Derived balance</th>
              <th className="p-3 text-left">Recent posted activity</th>
              <th className="p-3 text-left">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {treasuries.map((account) => (
              <tr key={account.id}>
                <td className="p-3">
                  <Link
                    className="text-[var(--accent)]"
                    href={`/accounting/cash-bank-accounts/${account.id}/ledger`}
                  >
                    {account.code} — {account.name}
                  </Link>
                </td>
                <td className="p-3">{account.accountType}</td>
                <td className="p-3">
                  {account.glAccount.code} — {account.glAccount.name}
                </td>
                <td className="p-3">{account.balance}</td>
                <td className="p-3 text-xs">
                  {account.recentActivity.length
                    ? account.recentActivity.map((line) => (
                        <div key={`${line.journalNumber}-${line.date.toISOString()}`}>
                          {line.date.toISOString().slice(0, 10)} {line.journalNumber}: {line.amount}
                        </div>
                      ))
                    : "No posted activity"}
                </td>
                <td className="p-3">{account.active ? "Active" : "Inactive"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </ResponsiveContainer>
  );
}
