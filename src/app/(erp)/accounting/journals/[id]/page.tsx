import { notFound } from "next/navigation";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/layout/page-header";
import { ResponsiveContainer } from "@/components/ui/responsive-container";
import { ManualJournalReversalForm } from "@/components/accounting/accounting-management-forms";
import { requirePermission } from "@/server/auth/server-guards";
import { prisma } from "@/server/db/prisma";
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission("accounting.view");
  const journal = await prisma.accountingJournal.findUnique({
    where: { id: (await params).id },
    include: {
      postedBy: true,
      lines: { include: { account: true }, orderBy: { position: "asc" } },
      reversalJournal: { select: { journalNumber: true } },
    },
  });
  if (!journal) notFound();
  return (
    <ResponsiveContainer>
      <PageHeader
        title={journal.journalNumber}
        description={`${journal.sourceType} ${journal.sourceNumber ?? journal.sourceId} — ${journal.status}`}
      />
      <Card className="mb-4 p-4 text-sm">
        <p>{journal.description}</p>
        <p className="mt-1">
          Posted by {journal.postedBy?.name ?? "—"} at {journal.postedAt?.toLocaleString() ?? "—"}
        </p>
        {journal.sourceType === "MANUAL_JOURNAL" &&
        journal.status === "POSTED" &&
        !journal.reversalJournal ? (
          <ManualJournalReversalForm journalId={journal.id} />
        ) : null}
        {journal.reversalJournal ? (
          <p className="mt-2">Reversed by {journal.reversalJournal.journalNumber}.</p>
        ) : null}
      </Card>
      <Card className="overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr>
              <th className="p-3 text-left">Account</th>
              <th className="p-3 text-left">Description</th>
              <th className="p-3 text-left">Debit</th>
              <th className="p-3 text-left">Credit</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {journal.lines.map((line) => (
              <tr key={line.id}>
                <td className="p-3">
                  {line.account.code} — {line.account.name}
                </td>
                <td className="p-3">{line.description ?? ""}</td>
                <td className="p-3">{line.debit.toString()}</td>
                <td className="p-3">{line.credit.toString()}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="font-semibold">
              <td className="p-3" colSpan={2}>
                Total
              </td>
              <td className="p-3">{journal.totalDebit.toString()}</td>
              <td className="p-3">{journal.totalCredit.toString()}</td>
            </tr>
          </tfoot>
        </table>
      </Card>
    </ResponsiveContainer>
  );
}
