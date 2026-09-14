import { WasteDispositionForm } from "@/components/inventory/waste-disposition-form";
import { PageHeader } from "@/components/layout/page-header";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ResponsiveContainer } from "@/components/ui/responsive-container";
import { requirePermission } from "@/server/auth/server-guards";
import { PrismaWasteDispositionRepository } from "@/server/inventory/prisma-waste-disposition-repository";
import { saveWasteDispositionAction } from "../actions";

export default async function NewWasteDispositionPage() {
  await requirePermission("inventory.manage");
  const sources = await new PrismaWasteDispositionRepository().listSourceOptions();
  return (
    <ResponsiveContainer>
      <PageHeader
        title="New Waste & Damage disposition"
        description="Select exact lot custody and save a draft. Scrap and reprocess moves retain owned value; only Write off derecognizes inventory."
      />
      {sources.length === 0 ? (
        <EmptyState
          title="No eligible damaged, quarantined, or scrap stock"
          description="This workbench lists only positive lot-specific DAMAGED, QUARANTINE, and SCRAP custody."
        />
      ) : (
        <Card className="p-5">
          <WasteDispositionForm action={saveWasteDispositionAction} sources={sources} />
        </Card>
      )}
    </ResponsiveContainer>
  );
}
