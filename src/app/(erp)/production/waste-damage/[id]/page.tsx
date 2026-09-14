import Link from "next/link";
import { notFound } from "next/navigation";

import {
  WastePostAction,
  WasteReasonAction,
} from "@/components/inventory/waste-disposition-actions";
import { PageHeader } from "@/components/layout/page-header";
import { CustodyRail } from "@/components/production/custody-rail";
import { Card } from "@/components/ui/card";
import { ResponsiveContainer } from "@/components/ui/responsive-container";
import { StatusBadge } from "@/components/ui/status-badge";
import { hasPermission } from "@/modules/access/domain/principal";
import { requirePermission } from "@/server/auth/server-guards";
import { PrismaWasteDispositionRepository } from "@/server/inventory/prisma-waste-disposition-repository";
import {
  cancelWasteDispositionAction,
  postWasteDispositionAction,
  reverseWasteDispositionAction,
} from "../actions";

export default async function WasteDispositionDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const principal = await requirePermission("inventory.view");
  const document = await new PrismaWasteDispositionRepository().getDocument((await params).id);
  if (!document) notFound();
  const canManage = hasPermission(principal, "inventory.manage");
  const first = document.lines[0];
  const destination = first
    ? first.action === "MOVE_TO_SCRAP"
      ? "SCRAP"
      : first.action === "MOVE_TO_REPROCESS"
        ? "REPROCESS"
        : "Removed from owned inventory"
    : "No lines";
  return (
    <ResponsiveContainer>
      <PageHeader
        title={document.documentNumber}
        description="Immutable lot-level disposition, valuation, accounting, reversal, and downstream Reprocess history."
        actions={
          <StatusBadge
            tone={
              document.status === "POSTED"
                ? "positive"
                : document.status === "DRAFT"
                  ? "info"
                  : "warning"
            }
          >
            {document.status}
          </StatusBadge>
        }
      />
      {first && (
        <Card className="mb-5 p-4">
          <CustodyRail
            nodes={[
              {
                label: "Source custody",
                value: `${first.sourceStatus} · ${first.productionLot?.lotNumber ?? first.inventoryLot?.supplierLotNumber ?? "Unnumbered lot"}`,
              },
              { label: "Controlled action", value: first.action.replaceAll("_", " ") },
              { label: "Outcome", value: destination },
            ]}
          />
        </Card>
      )}
      <Card className="mb-5 grid gap-4 p-5 md:grid-cols-2 xl:grid-cols-4">
        <Info label="Date" value={document.dispositionDate.toLocaleDateString()} />
        <Info label="Warehouse" value={`${document.warehouse.code} · ${document.warehouse.name}`} />
        <Info label="Created by" value={document.createdBy.name} />
        <Info label="Posted by" value={document.postedBy?.name ?? "Pending"} />
        <Info label="Cancellation" value={document.cancellationReason ?? "-"} />
        <Info
          label="Reversal"
          value={
            document.reversal
              ? document.reversal.documentNumber
              : document.reversalOf
                ? `Reversal of ${document.reversalOf.documentNumber}`
                : "-"
          }
        />
        <Info label="Reversed by" value={document.reversedBy?.name ?? "-"} />
        <Info label="Notes" value={document.notes ?? "-"} />
      </Card>
      <Card className="mb-5 overflow-hidden">
        <div className="border-b p-5">
          <h2 className="font-semibold">Disposition lines and provenance</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[78rem] text-left text-sm">
            <thead className="bg-[var(--surface)]">
              <tr>
                <th className="p-4">Item / lot</th>
                <th className="p-4">Source</th>
                <th className="p-4">Quantity</th>
                <th className="p-4">Action / reason</th>
                <th className="p-4">Ledger rows</th>
                <th className="p-4">Value / journal</th>
                <th className="p-4">Downstream Reprocess</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {document.lines.map((line) => {
                const claim = line.reprocessSourceContributions[0]?.reprocessDocument;
                return (
                  <tr key={line.id}>
                    <td className="p-4">
                      {line.item.code} · {line.item.name}
                      <br />
                      <span className="font-mono text-xs">
                        {line.productionLot?.lotNumber ??
                          line.inventoryLot?.supplierLotNumber ??
                          "Unnumbered"}
                      </span>
                    </td>
                    <td className="p-4">{line.sourceStatus}</td>
                    <td className="p-4">
                      {line.enteredQuantity.toString()} {line.canonicalUnit.symbol}
                    </td>
                    <td className="p-4">
                      {line.action}
                      <br />
                      <span className="text-xs text-[var(--muted)]">{line.reason}</span>
                    </td>
                    <td className="p-4">{line.inventoryMovements.length}</td>
                    <td className="p-4">
                      {line.originalValue?.toString() ?? "Retained"}
                      <br />
                      <span className="font-mono text-xs">
                        {line.originalAccountingJournalId ?? "No journal"}
                      </span>
                    </td>
                    <td className="p-4">
                      {claim ? (
                        <Link
                          className="font-mono text-[var(--accent)]"
                          href={`/production/reprocess/${claim.id}`}
                        >
                          {claim.documentNumber}
                          {claim.childProductionLot
                            ? ` → ${claim.childProductionLot.lotNumber}`
                            : ""}
                        </Link>
                      ) : (
                        "-"
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
      {canManage && document.status === "DRAFT" && (
        <Card className="mb-5 space-y-4 p-5">
          <div className="flex flex-wrap gap-2">
            <Link
              className="rounded-lg border px-4 py-2 font-semibold"
              href={`/production/waste-damage/${document.id}/edit`}
            >
              Edit draft
            </Link>
          </div>
          <WastePostAction action={postWasteDispositionAction} id={document.id} />
          <WasteReasonAction action={cancelWasteDispositionAction} id={document.id} kind="cancel" />
        </Card>
      )}
      {canManage &&
        document.status === "POSTED" &&
        !document.reversal &&
        !document.reversalOfId && (
          <Card className="p-5">
            <h2 className="mb-3 font-semibold">Compensating correction</h2>
            <p className="mb-4 text-sm text-[var(--muted)]">
              Reversal is allowed only while exact destination custody remains unused. It never
              edits the original entries.
            </p>
            <WasteReasonAction
              action={reverseWasteDispositionAction}
              id={document.id}
              kind="reverse"
            />
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
