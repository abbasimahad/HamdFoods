import Link from "next/link";
import { notFound } from "next/navigation";
import {
  CancelDocumentForm,
  DocumentReversalForm,
  PostDocumentForm,
} from "@/components/accounting/phase23-forms";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/layout/page-header";
import { ResponsiveContainer } from "@/components/ui/responsive-container";
import { hasPermission } from "@/modules/access/domain/principal";
import { requirePermission } from "@/server/auth/server-guards";
import { prisma } from "@/server/db/prisma";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const principal = await requirePermission("accounting.view");
  const transfer = await prisma.treasuryTransfer.findUnique({
    where: { id: (await params).id },
    include: {
      sourceTreasuryAccount: true,
      destinationTreasuryAccount: true,
      reversalOf: true,
      reversalTransfer: true,
    },
  });
  if (!transfer) notFound();
  return (
    <ResponsiveContainer>
      <PageHeader title={transfer.number} description={`${transfer.status} treasury transfer.`} />
      <Card className="p-4 text-sm">
        <p>Date: {transfer.transferDate.toISOString().slice(0, 10)}</p>
        <p>From: {transfer.sourceTreasuryAccount.name}</p>
        <p>To: {transfer.destinationTreasuryAccount.name}</p>
        <p>Amount: {transfer.amount.toString()}</p>
        <p>Reference: {transfer.referenceNumber ?? "—"}</p>
        <p>Notes: {transfer.notes ?? "—"}</p>
        <p>
          <Link
            className="text-[var(--accent)]"
            href={`/accounting/transfers/${transfer.id}/print`}
          >
            Print-friendly transfer
          </Link>
        </p>
        {transfer.reversalOf ? <p>Reversal of: {transfer.reversalOf.number}</p> : null}
        {transfer.reversalTransfer ? <p>Reversed by: {transfer.reversalTransfer.number}</p> : null}
        {transfer.status === "DRAFT" && hasPermission(principal, "accounting.manage") ? (
          <div className="mt-3">
            <PostDocumentForm id={transfer.id} type="transfer" />
            <CancelDocumentForm id={transfer.id} type="transfer" />
          </div>
        ) : null}
        {transfer.status === "POSTED" && hasPermission(principal, "accounting.manage") ? (
          transfer.reversalOf || transfer.reversalTransfer ? (
            <p className="mt-3">This transfer is part of a linked reversal.</p>
          ) : (
            <DocumentReversalForm id={transfer.id} type="transfer" />
          )
        ) : null}
      </Card>
    </ResponsiveContainer>
  );
}
