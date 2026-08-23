import { PurchaseOrderForm } from "@/components/purchasing/purchase-order-form";
import { PageHeader } from "@/components/layout/page-header";
import { Card } from "@/components/ui/card";
import { ResponsiveContainer } from "@/components/ui/responsive-container";
import { requirePermission } from "@/server/auth/server-guards";
import { PrismaPurchasingRepository } from "@/server/purchasing/prisma-purchasing-repository";
import { savePurchaseOrderAction } from "../actions";

export default async function NewPurchaseOrderPage() {
  await requirePermission("purchasing.manage");
  const repository = new PrismaPurchasingRepository();
  const [suppliers, items, units] = await Promise.all([
    repository.listActiveSuppliers(),
    repository.listCatalogItems(),
    repository.listCatalogUnits(),
  ]);
  return (
    <ResponsiveContainer>
      <PageHeader
        title="New Purchase Order"
        description="Create an editable purchasing commitment. No stock or accounting entry is posted."
      />
      <Card className="p-5">
        <PurchaseOrderForm
          action={savePurchaseOrderAction}
          suppliers={suppliers}
          items={items}
          units={units}
        />
      </Card>
    </ResponsiveContainer>
  );
}
