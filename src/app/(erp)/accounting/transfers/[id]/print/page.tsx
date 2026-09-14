import { notFound } from "next/navigation";
import { PrintCompanyHeader } from "@/components/administration/print-company-header";
import { PrismaCompanyProfileRepository } from "@/server/administration/prisma-company-profile-repository";
import { requirePermission } from "@/server/auth/server-guards";
import { prisma } from "@/server/db/prisma";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission("accounting.view");
  const [transfer, companyProfile] = await Promise.all([
    prisma.treasuryTransfer.findUnique({
      where: { id: (await params).id },
      include: { sourceTreasuryAccount: true, destinationTreasuryAccount: true },
    }),
    new PrismaCompanyProfileRepository().getCompanyProfile(),
  ]);
  if (!transfer) notFound();
  return (
    <main className="mx-auto max-w-2xl p-8 print:max-w-none print:p-0">
      <PrintCompanyHeader profile={companyProfile} />
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
