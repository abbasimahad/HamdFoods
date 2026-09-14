import Link from "next/link";
import { notFound } from "next/navigation";

import { PageHeader } from "@/components/layout/page-header";
import { CustodyRail } from "@/components/production/custody-rail";
import {
  ReprocessLifecycleAction,
  ReprocessReasonAction,
} from "@/components/production/reprocess-actions";
import { Card } from "@/components/ui/card";
import { ResponsiveContainer } from "@/components/ui/responsive-container";
import { StatusBadge } from "@/components/ui/status-badge";
import { hasPermission } from "@/modules/access/domain/principal";
import { requireAnyPermission } from "@/server/auth/server-guards";
import { PrismaReprocessRepository } from "@/server/production/prisma-reprocess-repository";
import { cancelReprocessAction, reserveReprocessAction, startReprocessAction } from "../actions";

export default async function ReprocessDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const principal = await requireAnyPermission(["production.view", "quality.manage"]);
  const document = await new PrismaReprocessRepository().getDocument((await params).id);
  if (!document) notFound();
  const source = document.sourceContributions[0];
  const canManage = hasPermission(principal, "production.manage");
  const canQuality = hasPermission(principal, "quality.manage");
  return (
    <ResponsiveContainer>
      <PageHeader
        title={document.documentNumber}
        description={`Controlled Reprocess document for ${document.finishedGood.code} / ${document.finishedGood.name}.`}
        actions={
          <StatusBadge
            tone={
              document.status === "RELEASED"
                ? "positive"
                : document.status === "REJECTED" || document.status === "CANCELLED"
                  ? "warning"
                  : "info"
            }
          >
            {document.status}
          </StatusBadge>
        }
      />
      <Card className="mb-5 p-4">
        <CustodyRail
          nodes={[
            {
              label: "Source lot",
              value: `${source?.sourceProductionLot.lotNumber ?? "Missing"} / ${source?.enteredQuantity ?? "-"}`,
            },
            {
              label: "Reprocess / WIP",
              value: (
                <Link
                  className="text-[var(--accent)]"
                  href={`/production/batches/${document.linkedProductionBatchId}`}
                >
                  {document.linkedProductionBatch.batchNumber} /{" "}
                  {document.linkedProductionBatch.status}
                </Link>
              ),
            },
            {
              label: "Child lot / QC",
              value: document.childProductionLot
                ? `${document.childProductionLot.lotNumber} / ${document.qcDecision?.decision ?? "QUALITY_HOLD"}`
                : "Pending output",
            },
          ]}
        />
      </Card>
      <Card className="mb-5 grid gap-4 p-5 md:grid-cols-2 xl:grid-cols-4">
        <Info label="Source warehouse" value={document.sourceWarehouse.code} />
        <Info
          label="Source quantity"
          value={source ? `${source.enteredQuantity} ${source.sourceStatus}` : "-"}
        />
        <Info
          label="Source expiry snapshot"
          value={document.sourceExpirySnapshot.toLocaleDateString()}
        />
        <Info label="Shelf-life snapshot" value={`${document.shelfLifeDaysSnapshot} days`} />
        <Info
          label="Completion date"
          value={document.completionDate?.toLocaleDateString() ?? "Pending"}
        />
        <Info
          label="Child expiry"
          value={document.childExpiry?.toLocaleDateString() ?? "Pending"}
        />
        <Info label="Initiated by" value={document.initiatedBy.name} />
        <Info label="Completed by" value={document.completedBy?.name ?? "Pending"} />
        <Info
          label="GOOD / scrap / loss"
          value={`${document.goodContentOutput ?? "-"} / ${document.scrapContentOutput ?? "-"} / ${document.processLossContent ?? "-"}`}
        />
        <Info label="QC inspector" value={document.qcDecision?.inspectedBy.name ?? "Pending"} />
        <Info
          label="Source disposition"
          value={
            source?.sourceWasteDispositionLine?.disposition.documentNumber ??
            "Production / inventory provenance"
          }
        />
        <Info
          label="Final cost pool"
          value={
            document.linkedProductionBatch.productionCostSnapshot?.finishedGoodsCostPool?.toString() ??
            "Not finalized"
          }
        />
      </Card>
      <Card className="mb-5 p-5">
        <h2 className="font-semibold">Reason and notes</h2>
        <p className="mt-2 text-sm">{document.reason}</p>
        <p className="mt-2 whitespace-pre-wrap text-sm text-[var(--muted)]">
          {document.notes ?? "No notes."}
        </p>
      </Card>
      {canManage && ["DRAFT", "RESERVED", "IN_PROGRESS"].includes(document.status) && (
        <Card className="mb-5 space-y-4 p-5">
          <h2 className="font-semibold">Production actions</h2>
          {document.status === "DRAFT" && (
            <div className="flex flex-wrap gap-3">
              <Link
                className="inline-flex min-h-11 items-center rounded-lg border border-[var(--control-border)] px-4 font-semibold"
                href={`/production/reprocess/${document.id}/edit`}
              >
                Edit Reprocess draft
              </Link>
              <ReprocessLifecycleAction
                action={reserveReprocessAction}
                id={document.id}
                label="Reserve source lot"
                pendingLabel="Reserving..."
              />
            </div>
          )}
          {document.status === "RESERVED" && (
            <ReprocessLifecycleAction
              action={startReprocessAction}
              id={document.id}
              label="Start Reprocess"
              pendingLabel="Moving source to WIP..."
            />
          )}
          {document.status === "IN_PROGRESS" && (
            <Link
              className="inline-flex min-h-11 items-center rounded-lg bg-[var(--accent)] px-4 font-semibold text-white"
              href={`/production/batches/${document.linkedProductionBatchId}`}
            >
              Open linked production batch
            </Link>
          )}
          {["DRAFT", "RESERVED"].includes(document.status) && (
            <ReprocessReasonAction
              action={cancelReprocessAction}
              fieldLabel="Cancellation reason"
              id={document.id}
              label="Cancel Reprocess"
            />
          )}
        </Card>
      )}
      {canQuality && document.status === "AWAITING_QC" && (
        <Card className="p-5">
          <h2 className="mb-3 font-semibold">Independent quality decision</h2>
          <p className="mb-4 text-sm text-[var(--muted)]">
            The inspector must differ from both the initiator and completer. Approval releases the
            child lot; rejection quarantines it.
          </p>
          <Link
            className="inline-flex min-h-11 items-center rounded-lg bg-[var(--accent)] px-4 font-semibold text-white"
            href={`/production/reprocess/${document.id}/qc`}
          >
            Open quality review
          </Link>
        </Card>
      )}
    </ResponsiveContainer>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">{label}</p>
      <p className="mt-1 break-words text-sm font-medium">{value}</p>
    </div>
  );
}
