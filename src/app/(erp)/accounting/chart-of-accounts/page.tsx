import { PageHeader } from "@/components/layout/page-header";
import { ResponsiveContainer } from "@/components/ui/responsive-container";
import { Card } from "@/components/ui/card";
import {
  AccountingAccountForm,
  AccountingAccountStatusForm,
} from "@/components/accounting/accounting-management-forms";
import { hasPermission } from "@/modules/access/domain/principal";
import { requirePermission } from "@/server/auth/server-guards";
import { chartOfAccounts } from "@/server/accounting/prisma-accounting-repository";
export default async function Page() {
  const principal = await requirePermission("accounting.view");
  const accounts = await chartOfAccounts();
  const canManage = hasPermission(principal, "accounting.manage");
  return (
    <ResponsiveContainer>
      <PageHeader
        title="Chart of Accounts"
        description="Hierarchical accounts; control accounts remain source-driven."
      />
      {canManage ? (
        <Card className="mb-4 p-4">
          <h2 className="mb-3 font-semibold">Create account</h2>
          <AccountingAccountForm accounts={accounts} />
        </Card>
      ) : null}
      <Card className="overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr>
              <th className="p-3 text-left">Code</th>
              <th className="p-3 text-left">Account</th>
              <th className="p-3 text-left">Type</th>
              <th className="p-3 text-left">Posting</th>
              {canManage ? <th className="p-3 text-left">Action</th> : null}
            </tr>
          </thead>
          <tbody className="divide-y">
            {accounts.map((account) => (
              <tr key={account.id}>
                <td className="p-3">{account.code}</td>
                <td className="p-3">
                  {account.name}
                  {account.isControl ? " (control)" : ""}
                </td>
                <td className="p-3">{account.accountType}</td>
                <td className="p-3">
                  {account.active && account.postingAllowed ? "Allowed" : "Blocked"}
                </td>
                {canManage ? (
                  <td className="p-3">
                    <AccountingAccountStatusForm accountId={account.id} active={account.active} />
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </ResponsiveContainer>
  );
}
