import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { Card } from "@/components/ui/card";
import { ResponsiveContainer } from "@/components/ui/responsive-container";
import { hasPermission } from "@/modules/access/domain/principal";
import { requirePermission } from "@/server/auth/server-guards";
import { PrismaProductionPackagingRepository } from "@/server/production/prisma-production-packaging-repository";
export default async function Page({ params }: { params: Promise<{ transactionId: string }> }) {
  const principal = await requirePermission("production.view");
  const tx = await new PrismaProductionPackagingRepository().getTransaction(
    (await params).transactionId,
  );
  if (!tx) notFound();
  return (
    <ResponsiveContainer>
      <PageHeader
        title={tx.transactionNumber}
        description="Immutable packaging transaction provenance from the existing production-batch engine."
      />
      <Card className="grid gap-3 p-5 sm:grid-cols-2">
        <Fact l="Type / status" v={`${tx.transactionType} · ${tx.status}`} />
        <Fact l="Packaging" v={`${tx.line.itemCode} · ${tx.line.itemName}`} />
        <Fact l="Quantity" v={`${tx.line.enteredQuantity} ${tx.line.enteredUnitSymbol}`} />
        <Fact
          l="Lot / GRN"
          v={`${tx.line.supplierLotNumber ?? "No supplier lot"} · ${tx.line.goodsReceiptNumber}`}
        />
        <Fact l="Warehouse" v={tx.line.sourceWarehouseName} />
      </Card>
      <div className="mt-4 flex gap-2">
        <Link
          className="rounded border px-4 py-2"
          href={`/production/batches/${tx.productionBatchId}/packaging`}
        >
          Open batch workbench
        </Link>
        {tx.status === "DRAFT" && hasPermission(principal, "production.manage") ? (
          <Link
            className="rounded border px-4 py-2"
            href={`/production/packaging-consumption/${tx.id}/edit`}
          >
            Edit
          </Link>
        ) : null}
      </div>
    </ResponsiveContainer>
  );
}
function Fact({ l, v }: { l: string; v: string }) {
  return (
    <div>
      <span className="text-xs uppercase text-[var(--muted)]">{l}</span>
      <strong className="block">{v}</strong>
    </div>
  );
}
