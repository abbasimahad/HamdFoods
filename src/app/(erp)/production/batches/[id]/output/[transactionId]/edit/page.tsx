import { notFound, redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { OutputTransactionForm } from "@/components/production/output-transaction-form";
import { Card } from "@/components/ui/card";
import { ResponsiveContainer } from "@/components/ui/responsive-container";
import { requirePermission } from "@/server/auth/server-guards";
import { PrismaProductionOutputRepository } from "@/server/production/prisma-production-output-repository";
import { saveOutputTransactionAction } from "../../actions";

export default async function EditOutputPage({
  params,
}: {
  params: Promise<{ id: string; transactionId: string }>;
}) {
  await requirePermission("production.manage");
  const { id, transactionId } = await params;
  const repository = new PrismaProductionOutputRepository();
  const [view, transaction, units, warehouses] = await Promise.all([
    repository.getOutputView(id),
    repository.getTransaction(transactionId),
    repository.listUnits(),
    repository.listWarehouses(),
  ]);
  if (!view || !transaction || transaction.productionBatchId !== id) notFound();
  if (transaction.status !== "DRAFT" || view.batchStatus !== "IN_PROGRESS")
    redirect(`/production/batches/${id}/output`);
  return (
    <ResponsiveContainer>
      <PageHeader
        title={`Edit ${transaction.outputNumber}`}
        description="Only DRAFT output is editable and has no physical effect."
      />
      <Card className="p-5">
        <OutputTransactionForm
          action={saveOutputTransactionAction}
          initial={transaction}
          type={transaction.outputType}
          units={units}
          view={view}
          warehouses={warehouses}
        />
      </Card>
    </ResponsiveContainer>
  );
}
