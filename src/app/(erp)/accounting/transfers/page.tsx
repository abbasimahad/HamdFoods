import Link from "next/link";
import {
  CancelDocumentForm,
  PostDocumentForm,
  TreasuryTransferForm,
} from "@/components/accounting/phase23-forms";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/layout/page-header";
import { ResponsiveContainer } from "@/components/ui/responsive-container";
import { hasPermission } from "@/modules/access/domain/principal";
import { requirePermission } from "@/server/auth/server-guards";
import { treasuryAccounts } from "@/server/accounting/prisma-phase23-repository";
import { prisma } from "@/server/db/prisma";
export default async function Page() {
  const principal = await requirePermission("accounting.view");
  const [treasuries, transfers] = await Promise.all([
    treasuryAccounts(),
    prisma.treasuryTransfer.findMany({
      include: { sourceTreasuryAccount: true, destinationTreasuryAccount: true },
      orderBy: [{ transferDate: "desc" }, { number: "desc" }],
      take: 100,
    }),
  ]);
  return (
    <ResponsiveContainer>
      <PageHeader
        title="Treasury Transfers"
        description="Transfers move value between company cash, bank, and petty-cash GL accounts without income or expense."
      />
      {hasPermission(principal, "accounting.manage") ? (
        <Card className="mb-4 p-4">
          <TreasuryTransferForm treasuries={treasuries.filter((account) => account.active)} />
        </Card>
      ) : null}
      <Card className="overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr>
              <th className="p-3 text-left">Transfer</th>
              <th className="p-3 text-left">Date</th>
              <th className="p-3 text-left">Source</th>
              <th className="p-3 text-left">Destination</th>
              <th className="p-3 text-left">Amount</th>
              <th className="p-3 text-left">Status</th>
              <th className="p-3 text-left">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {transfers.map((transfer) => (
              <tr key={transfer.id}>
                <td className="p-3">
                  <Link
                    className="text-[var(--accent)]"
                    href={`/accounting/transfers/${transfer.id}`}
                  >
                    {transfer.number}
                  </Link>
                </td>
                <td className="p-3">{transfer.transferDate.toISOString().slice(0, 10)}</td>
                <td className="p-3">{transfer.sourceTreasuryAccount.name}</td>
                <td className="p-3">{transfer.destinationTreasuryAccount.name}</td>
                <td className="p-3">{transfer.amount.toString()}</td>
                <td className="p-3">{transfer.status}</td>
                <td className="p-3">
                  {transfer.status === "DRAFT" && hasPermission(principal, "accounting.manage") ? (
                    <>
                      <PostDocumentForm id={transfer.id} type="transfer" />
                      <CancelDocumentForm id={transfer.id} type="transfer" />
                    </>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </ResponsiveContainer>
  );
}
