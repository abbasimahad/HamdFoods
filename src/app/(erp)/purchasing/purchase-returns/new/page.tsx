import { PurchaseReturnForm } from "@/components/purchasing/purchase-return-form";
import { PageHeader } from "@/components/layout/page-header";
import { Card } from "@/components/ui/card";
import { ResponsiveContainer } from "@/components/ui/responsive-container";
import { requirePermission } from "@/server/auth/server-guards";
import { PrismaPurchaseReturnRepository } from "@/server/purchasing/prisma-purchase-return-repository";
import { savePurchaseReturnAction } from "../actions";
export default async function NewPurchaseReturnPage() {
  await requirePermission("purchasing.manage");
  const repository = new PrismaPurchaseReturnRepository();
  const [sources, units] = await Promise.all([
    repository.listEligibleReturnSources(),
    repository.listReturnUnits(),
  ]);
  return (
    <ResponsiveContainer>
      <PageHeader
        title="New Purchase Return"
        description="Select only traceable purchased lots already in quarantine."
      />
      <Card className="p-5">
        <PurchaseReturnForm action={savePurchaseReturnAction} sources={sources} units={units} />
      </Card>
    </ResponsiveContainer>
  );
}
