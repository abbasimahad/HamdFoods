import { notFound, redirect } from "next/navigation";
import { ProductionBatchForm } from "@/components/production/batch-form";
import { PageHeader } from "@/components/layout/page-header";
import { Card } from "@/components/ui/card";
import { ResponsiveContainer } from "@/components/ui/responsive-container";
import { requirePermission } from "@/server/auth/server-guards";
import { PrismaProductionBatchRepository } from "@/server/production/prisma-production-batch-repository";
import { saveProductionBatchAction } from "../../actions";

export default async function EditProductionBatchPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requirePermission("production.manage");
  const repository = new PrismaProductionBatchRepository();
  const batch = await repository.getBatch((await params).id);
  if (!batch) notFound();
  if (batch.status !== "DRAFT") redirect(`/production/batches/${batch.id}`);
  const [recipes, units, warehouses] = await Promise.all([
    repository.listApprovedRecipes(),
    repository.listBatchUnits(),
    repository.listActiveWarehouses(),
  ]);
  return (
    <ResponsiveContainer>
      <PageHeader
        title={`Edit ${batch.batchNumber}`}
        description="Recalculate this DRAFT plan from an approved recipe. Planning remains stock-neutral."
      />
      <Card className="p-5">
        <ProductionBatchForm
          action={saveProductionBatchAction}
          initial={batch}
          recipes={recipes}
          units={units}
          warehouses={warehouses}
        />
      </Card>
    </ResponsiveContainer>
  );
}
