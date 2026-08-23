import { notFound, redirect } from "next/navigation";
import { PurchaseOrderForm } from "@/components/purchasing/purchase-order-form";
import { PageHeader } from "@/components/layout/page-header";
import { Card } from "@/components/ui/card";
import { ResponsiveContainer } from "@/components/ui/responsive-container";
import { requirePermission } from "@/server/auth/server-guards";
import { PrismaPurchasingRepository } from "@/server/purchasing/prisma-purchasing-repository";
import { savePurchaseOrderAction } from "../../actions";

export default async function EditPurchaseOrderPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requirePermission("purchasing.manage");
  const repository = new PrismaPurchasingRepository();
  const order = await repository.getPurchaseOrder((await params).id);
  if (!order) notFound();
  if (order.status !== "DRAFT") redirect(`/purchasing/purchase-orders/${order.id}`);
  const [suppliers, items, units] = await Promise.all([
    repository.listActiveSuppliers(),
    repository.listCatalogItems(),
    repository.listCatalogUnits(),
  ]);
  return (
    <ResponsiveContainer>
      <PageHeader
        title={`Edit ${order.number}`}
        description="Only draft purchase orders can be changed."
      />
      <Card className="p-5">
        <PurchaseOrderForm
          action={savePurchaseOrderAction}
          suppliers={suppliers}
          items={items}
          units={units}
          initial={order}
        />
      </Card>
    </ResponsiveContainer>
  );
}
