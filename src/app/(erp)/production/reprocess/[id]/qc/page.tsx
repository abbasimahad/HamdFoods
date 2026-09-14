import { notFound, redirect } from "next/navigation";

import { PageHeader } from "@/components/layout/page-header";
import { ReprocessQualityAction } from "@/components/production/reprocess-actions";
import { Card } from "@/components/ui/card";
import { ResponsiveContainer } from "@/components/ui/responsive-container";
import { requirePermission } from "@/server/auth/server-guards";
import { PrismaReprocessRepository } from "@/server/production/prisma-reprocess-repository";
import { decideReprocessQualityAction } from "../../actions";

export default async function ReprocessQualityPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const principal = await requirePermission("quality.manage");
  const document = await new PrismaReprocessRepository().getDocument((await params).id);
  if (!document) notFound();
  if (document.status !== "AWAITING_QC") redirect(`/production/reprocess/${document.id}`);
  const selfReview =
    principal.id === document.initiatedByUserId || principal.id === document.completedByUserId;
  return (
    <ResponsiveContainer>
      <PageHeader
        title={`Quality review: ${document.documentNumber}`}
        description="Review the frozen child-lot result independently. Approval releases it; rejection moves it to quarantine."
      />
      <Card className="mb-5 grid gap-4 p-5 md:grid-cols-2">
        <Fact
          label="Finished good"
          value={`${document.finishedGood.code} / ${document.finishedGood.name}`}
        />
        <Fact label="Child lot" value={document.childProductionLot?.lotNumber ?? "Missing"} />
        <Fact
          label="Child expiry"
          value={document.childExpiry?.toLocaleDateString() ?? "Missing"}
        />
        <Fact
          label="GOOD / scrap / loss"
          value={`${document.goodContentOutput ?? "-"} / ${document.scrapContentOutput ?? "-"} / ${document.processLossContent ?? "-"}`}
        />
      </Card>
      <Card className="p-5">
        {selfReview ? (
          <p className="rounded-lg border border-[var(--danger-border)] bg-[var(--danger-surface)] p-4 text-sm text-[var(--danger-ink)]">
            Another authorized quality user must review this reprocess result.
          </p>
        ) : (
          <ReprocessQualityAction action={decideReprocessQualityAction} id={document.id} />
        )}
      </Card>
    </ResponsiveContainer>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">{label}</p>
      <p className="mt-1 break-words text-sm font-medium">{value}</p>
    </div>
  );
}
