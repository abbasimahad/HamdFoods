import { notFound, redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { PackagingTransactionForm } from "@/components/production/packaging-transaction-form";
import { Card } from "@/components/ui/card";
import { ResponsiveContainer } from "@/components/ui/responsive-container";
import { requirePermission } from "@/server/auth/server-guards";
import { PrismaProductionPackagingRepository } from "@/server/production/prisma-production-packaging-repository";
import { savePackagingTransactionAction } from "../../actions";

export default async function EditPackagingTransactionPage({
  params,
}: {
  params: Promise<{ id: string; transactionId: string }>;
}) {
  await requirePermission("production.manage");
  const { id, transactionId } = await params;
  const repository = new PrismaProductionPackagingRepository();
  const [view, transaction, units, warehouses] = await Promise.all([
    repository.getBatchPackagingView(id),
    repository.getTransaction(transactionId),
    repository.listUnits(),
    repository.listWarehouses(),
  ]);
  if (!view || !transaction || transaction.productionBatchId !== id) notFound();
  if (transaction.status !== "DRAFT") redirect(`/production/batches/${id}/packaging`);
  return (
    <ResponsiveContainer>
      <PageHeader
        title={`Edit ${transaction.transactionNumber}`}
        description="Only DRAFT packaging transactions are editable and have no stock effect."
      />
      <Card className="p-5">
        <PackagingTransactionForm
          action={savePackagingTransactionAction}
          initial={transaction}
          type={transaction.transactionType}
          units={units}
          view={view}
          warehouses={warehouses}
        />
      </Card>
    </ResponsiveContainer>
  );
}
