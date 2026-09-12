import Link from "next/link";
import { PageHeader } from "@/components/layout/page-header";
import { Card } from "@/components/ui/card";
import { ResponsiveContainer } from "@/components/ui/responsive-container";
import { requirePermission } from "@/server/auth/server-guards";
import { PrismaProductionTransactionWorkbench } from "@/server/production/prisma-production-transaction-workbench";
export default async function Page() {
  await requirePermission("production.manage");
  const batches = await new PrismaProductionTransactionWorkbench().eligibleBatches("packaging");
  return (
    <ResponsiveContainer>
      <PageHeader
        title="New Packaging Transaction"
        description="Choose an in-progress batch, then use its existing packaging transaction engine."
      />
      <div className="grid gap-3">
        {batches.map((batch) => (
          <Card className="flex items-center justify-between gap-3 p-4" key={batch.id}>
            <div>
              <strong>{batch.number}</strong>
              <p className="text-sm text-[var(--muted)]">
                {batch.product} · {batch.status}
              </p>
            </div>
            <Link
              className="rounded-lg bg-[var(--accent)] px-4 py-2 text-white"
              href={`/production/batches/${batch.id}/packaging?type=CONSUMPTION`}
            >
              Select batch
            </Link>
          </Card>
        ))}
      </div>
      <Link
        className="mt-4 inline-block rounded border px-4 py-2"
        href="/production/packaging-consumption"
      >
        Cancel
      </Link>
    </ResponsiveContainer>
  );
}
