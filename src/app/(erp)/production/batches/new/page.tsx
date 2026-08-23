import { ProductionBatchForm } from "@/components/production/batch-form";
import { PageHeader } from "@/components/layout/page-header";
import { Card } from "@/components/ui/card";
import { ResponsiveContainer } from "@/components/ui/responsive-container";
import { requirePermission } from "@/server/auth/server-guards";
import { PrismaProductionBatchRepository } from "@/server/production/prisma-production-batch-repository";
import { saveProductionBatchAction } from "../actions";

export default async function NewProductionBatchPage() {
  await requirePermission("production.manage");
  const repository = new PrismaProductionBatchRepository();
  const [recipes, units, warehouses] = await Promise.all([
    repository.listApprovedRecipes(),
    repository.listBatchUnits(),
    repository.listActiveWarehouses(),
  ]);
  return (
    <ResponsiveContainer>
      <PageHeader
        title="New Production Batch"
        description="Scale an approved recipe into a planning-only requirement snapshot. No stock is reserved or consumed."
      />
      <Card className="p-5">
        {recipes.length === 0 || warehouses.length === 0 ? (
          <p className="text-sm text-amber-800">
            An approved recipe and at least one active warehouse are required before a batch can be
            created.
          </p>
        ) : (
          <ProductionBatchForm
            action={saveProductionBatchAction}
            recipes={recipes}
            units={units}
            warehouses={warehouses}
          />
        )}
      </Card>
    </ResponsiveContainer>
  );
}
