import { PageHeader } from "@/components/layout/page-header";
import { ReprocessForm } from "@/components/production/reprocess-form";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ResponsiveContainer } from "@/components/ui/responsive-container";
import { requirePermission } from "@/server/auth/server-guards";
import { PrismaProductionBatchRepository } from "@/server/production/prisma-production-batch-repository";
import { PrismaReprocessRepository } from "@/server/production/prisma-reprocess-repository";
import { saveReprocessDraftAction } from "../actions";

export default async function NewReprocessPage() {
  await requirePermission("production.manage");
  const repository = new PrismaReprocessRepository();
  const batches = new PrismaProductionBatchRepository();
  const [sources, recipes, warehouses] = await Promise.all([
    repository.listEligibleSources(),
    batches.listApprovedRecipes(),
    batches.listActiveWarehouses(),
  ]);
  return (
    <ResponsiveContainer>
      <PageHeader
        title="New Reprocess"
        description="Select already-segregated REPROCESS custody and create one linked production batch. Saving does not consume stock."
      />
      {sources.length === 0 ? (
        <EmptyState
          title="No eligible REPROCESS custody"
          description="Use Waste & Damage to move an unexpired finished-good lot with an approved reprocess shelf-life policy into REPROCESS custody."
        />
      ) : (
        <Card className="p-5">
          <ReprocessForm
            action={saveReprocessDraftAction}
            recipes={recipes}
            sources={sources}
            warehouses={warehouses}
          />
        </Card>
      )}
    </ResponsiveContainer>
  );
}
