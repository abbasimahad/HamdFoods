import { notFound, redirect } from "next/navigation";
import { MaterialTransactionForm } from "@/components/production/material-transaction-form";
import { PageHeader } from "@/components/layout/page-header";
import { Card } from "@/components/ui/card";
import { ResponsiveContainer } from "@/components/ui/responsive-container";
import { requirePermission } from "@/server/auth/server-guards";
import { PrismaProductionMaterialRepository } from "@/server/production/prisma-production-material-repository";
import { saveMaterialTransactionAction } from "../../actions";

export default async function EditMaterialTransactionPage({
  params,
}: {
  params: Promise<{ id: string; transactionId: string }>;
}) {
  await requirePermission("production.manage");
  const { id, transactionId } = await params;
  const repository = new PrismaProductionMaterialRepository();
  const [transaction, view, units, warehouses] = await Promise.all([
    repository.getTransaction(transactionId),
    repository.getBatchMaterialView(id),
    repository.listUnits(),
    repository.listWarehouses(),
  ]);
  if (!transaction || !view || transaction.productionBatchId !== id) notFound();
  if (transaction.status !== "DRAFT") redirect(`/production/batches/${id}/materials`);
  return (
    <ResponsiveContainer>
      <PageHeader
        title={`Edit ${transaction.transactionNumber}`}
        description="Only DRAFT material transactions can change; stock is checked again when posted."
      />
      <Card className="p-5">
        <MaterialTransactionForm
          action={saveMaterialTransactionAction}
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
