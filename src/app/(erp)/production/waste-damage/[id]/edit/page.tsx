import { notFound, redirect } from "next/navigation";

import { WasteDispositionForm } from "@/components/inventory/waste-disposition-form";
import { PageHeader } from "@/components/layout/page-header";
import { Card } from "@/components/ui/card";
import { ResponsiveContainer } from "@/components/ui/responsive-container";
import { requirePermission } from "@/server/auth/server-guards";
import { PrismaWasteDispositionRepository } from "@/server/inventory/prisma-waste-disposition-repository";
import { saveWasteDispositionAction } from "../../actions";

export default async function EditWasteDispositionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requirePermission("inventory.manage");
  const repository = new PrismaWasteDispositionRepository();
  const id = (await params).id;
  const [document, sources] = await Promise.all([
    repository.getDocument(id),
    repository.listSourceOptions(),
  ]);
  if (!document) notFound();
  if (document.status !== "DRAFT") redirect(`/production/waste-damage/${document.id}`);
  return (
    <ResponsiveContainer>
      <PageHeader
        title={`Edit ${document.documentNumber}`}
        description="Draft lines remain editable until posting. No inventory, valuation, or accounting effect exists yet."
      />
      <Card className="p-5">
        <WasteDispositionForm
          action={saveWasteDispositionAction}
          sources={sources}
          initial={{
            id: document.id,
            warehouseId: document.warehouseId,
            dispositionDate: document.dispositionDate.toISOString().slice(0, 10),
            notes: document.notes ?? "",
            lines: document.lines.map((line) => ({
              itemId: line.itemId,
              inventoryLotId: line.inventoryLotId,
              productionLotId: line.productionLotId,
              sourceStatus: line.sourceStatus as "DAMAGED" | "QUARANTINE" | "SCRAP",
              unitId: line.canonicalUnitId,
              quantity: line.enteredQuantity.toString(),
              action: line.action,
              reason: line.reason,
              notes: line.notes ?? "",
            })),
          }}
        />
      </Card>
    </ResponsiveContainer>
  );
}
