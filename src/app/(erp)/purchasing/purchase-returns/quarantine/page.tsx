import { PurchasedMaterialQuarantineForm } from "@/components/purchasing/purchased-material-quarantine-form";
import { PageHeader } from "@/components/layout/page-header";
import { Card } from "@/components/ui/card";
import { ResponsiveContainer } from "@/components/ui/responsive-container";
import { requirePermission } from "@/server/auth/server-guards";
import { PrismaPurchaseReturnRepository } from "@/server/purchasing/prisma-purchase-return-repository";
import { quarantinePurchasedMaterialAction } from "../actions";
export default async function PurchasedMaterialQuarantinePage() {
  await requirePermission("purchasing.manage");
  const repository = new PrismaPurchaseReturnRepository();
  const [lots, units] = await Promise.all([
    repository.listPurchasedLotsWithAvailableStock(),
    repository.listReturnUnits(),
  ]);
  return (
    <ResponsiveContainer>
      <PageHeader
        title="Send Purchased Material to Quarantine"
        description="Classify a defect found after QC acceptance before returning material to its supplier."
      />
      <Card className="p-5">
        <PurchasedMaterialQuarantineForm
          action={quarantinePurchasedMaterialAction}
          lots={lots}
          units={units}
        />
      </Card>
    </ResponsiveContainer>
  );
}
