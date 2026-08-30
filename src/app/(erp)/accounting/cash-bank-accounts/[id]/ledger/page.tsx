import { notFound } from "next/navigation";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/layout/page-header";
import { ResponsiveContainer } from "@/components/ui/responsive-container";
import { requirePermission } from "@/server/auth/server-guards";
import { prisma } from "@/server/db/prisma";
import Decimal from "decimal.js";
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission("accounting.view");
  const account = await prisma.treasuryAccount.findUnique({
    where: { id: (await params).id },
    include: { glAccount: true },
  });
  if (!account) notFound();
  const lines = await prisma.accountingJournalLine.findMany({
    where: { accountId: account.glAccountId, journal: { status: "POSTED" } },
    include: { journal: true },
    orderBy: [{ journal: { accountingDate: "asc" } }, { position: "asc" }],
  });
  const rows = lines.reduce<readonly { line: (typeof lines)[number]; runningBalance: string }[]>(
    (result, line) => {
      const previous = result.at(-1)?.runningBalance ?? "0";
      return [
        ...result,
        { line, runningBalance: new Decimal(previous).add(line.debit).sub(line.credit).toFixed(6) },
      ];
    },
    [],
  );
  return (
    <ResponsiveContainer>
      <PageHeader
        title={`${account.code} — ${account.name}`}
        description="Posted GL activity and derived running balance."
      />
      <Card className="overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr>
              <th className="p-3 text-left">Date</th>
              <th className="p-3 text-left">Reference</th>
              <th className="p-3 text-left">Source</th>
              <th className="p-3 text-left">Debit</th>
              <th className="p-3 text-left">Credit</th>
              <th className="p-3 text-left">Balance</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.map(({ line, runningBalance }) => {
              return (
                <tr key={line.id}>
                  <td className="p-3">{line.journal.accountingDate.toISOString().slice(0, 10)}</td>
                  <td className="p-3">{line.journal.journalNumber}</td>
                  <td className="p-3">{line.journal.sourceType}</td>
                  <td className="p-3">{line.debit.toString()}</td>
                  <td className="p-3">{line.credit.toString()}</td>
                  <td className="p-3">{runningBalance}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>
    </ResponsiveContainer>
  );
}
