import { notFound } from "next/navigation";
import { requirePermission } from "@/server/auth/server-guards";
import { prisma } from "@/server/db/prisma";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission("accounting.view");
  const transfer = await prisma.treasuryTransfer.findUnique({
    where: { id: (await params).id },
    include: { sourceTreasuryAccount: true, destinationTreasuryAccount: true },
  });
  if (!transfer) notFound();
  return (
    <main className="mx-auto max-w-2xl p-8 print:max-w-none print:p-0">
      <h1 className="text-2xl font-semibold">Treasury Transfer {transfer.number}</h1>
      <dl className="mt-5 grid grid-cols-2 gap-3">
        <dt>Date</dt>
        <dd>{transfer.transferDate.toISOString().slice(0, 10)}</dd>
        <dt>Source</dt>
        <dd>{transfer.sourceTreasuryAccount.name}</dd>
        <dt>Destination</dt>
        <dd>{transfer.destinationTreasuryAccount.name}</dd>
        <dt>Amount</dt>
        <dd>{transfer.amount.toString()}</dd>
        <dt>Reference</dt>
        <dd>{transfer.referenceNumber ?? "—"}</dd>
        <dt>Notes</dt>
        <dd>{transfer.notes ?? "—"}</dd>
      </dl>
    </main>
  );
}
