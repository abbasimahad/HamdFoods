import { GoodsReceiptForm } from "@/components/purchasing/goods-receipt-form";
import { PageHeader } from "@/components/layout/page-header";
import { Card } from "@/components/ui/card";
import { ResponsiveContainer } from "@/components/ui/responsive-container";
import { requirePermission } from "@/server/auth/server-guards";
import { PrismaGoodsReceiptRepository } from "@/server/purchasing/prisma-goods-receipt-repository";
import { saveGoodsReceiptAction } from "../actions";
export default async function NewGoodsReceiptPage({
  searchParams,
}: {
  searchParams: Promise<{ po?: string }>;
}) {
  await requirePermission("purchasing.manage");
  const repository = new PrismaGoodsReceiptRepository();
  const [ordersRaw, warehouses, units, replacementTargets] = await Promise.all([
    repository.listReceivablePurchaseOrders(),
    repository.listReceivingWarehouses(),
    repository.listReceivingUnits(),
    repository.listReplacementTargets(),
  ]);
  const selected = (await searchParams).po;
  const orders = selected ? [...ordersRaw].sort((a) => (a.id === selected ? -1 : 1)) : ordersRaw;
  return (
    <ResponsiveContainer>
      <PageHeader
        title="New Goods Receipt"
        description="Draft receipt lines against one approved purchase order. Stock changes only when posted."
      />
      <Card className="p-5">
        <GoodsReceiptForm
          action={saveGoodsReceiptAction}
          orders={orders}
          warehouses={warehouses}
          units={units}
          replacementTargets={replacementTargets}
        />
      </Card>
    </ResponsiveContainer>
  );
}
