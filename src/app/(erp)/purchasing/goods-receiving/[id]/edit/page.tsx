import { notFound, redirect } from "next/navigation";
import { GoodsReceiptForm } from "@/components/purchasing/goods-receipt-form";
import { PageHeader } from "@/components/layout/page-header";
import { Card } from "@/components/ui/card";
import { ResponsiveContainer } from "@/components/ui/responsive-container";
import { requirePermission } from "@/server/auth/server-guards";
import { PrismaGoodsReceiptRepository } from "@/server/purchasing/prisma-goods-receipt-repository";
import { saveGoodsReceiptAction } from "../../actions";
export default async function EditGoodsReceiptPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requirePermission("purchasing.manage");
  const repository = new PrismaGoodsReceiptRepository();
  const receipt = await repository.getGoodsReceipt((await params).id);
  if (!receipt) notFound();
  if (receipt.status !== "DRAFT") redirect(`/purchasing/goods-receiving/${receipt.id}`);
  const [order, warehouses, units, replacementTargets] = await Promise.all([
    repository.getReceivablePurchaseOrder(receipt.purchaseOrderId),
    repository.listReceivingWarehouses(),
    repository.listReceivingUnits(),
    repository.listReplacementTargets(),
  ]);
  if (!order) redirect(`/purchasing/goods-receiving/${receipt.id}`);
  return (
    <ResponsiveContainer>
      <PageHeader
        title={`Edit ${receipt.number}`}
        description="Only draft receipt details can be changed."
      />
      <Card className="p-5">
        <GoodsReceiptForm
          action={saveGoodsReceiptAction}
          orders={[order]}
          warehouses={warehouses}
          units={units}
          replacementTargets={replacementTargets}
          initial={receipt}
        />
      </Card>
    </ResponsiveContainer>
  );
}
