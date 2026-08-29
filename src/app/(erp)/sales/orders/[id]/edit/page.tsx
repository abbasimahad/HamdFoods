import { notFound, redirect } from "next/navigation";
import { SalesOrderForm } from "@/components/sales/sales-order-form";
import { PageHeader } from "@/components/layout/page-header";
import { Card } from "@/components/ui/card";
import { ResponsiveContainer } from "@/components/ui/responsive-container";
import { requirePermission } from "@/server/auth/server-guards";
import { PrismaSalesOrderRepository } from "@/server/sales/prisma-sales-order-repository";
import { saveSalesOrderAction } from "../../actions";
export default async function EditSalesOrderPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission("sales.manage");
  const repository = new PrismaSalesOrderRepository();
  const order = await repository.getSalesOrder((await params).id);
  if (!order) notFound();
  if (order.status !== "DRAFT") redirect(`/sales/orders/${order.id}`);
  const references = await repository.getSalesOrderReferences();
  return (
    <ResponsiveContainer>
      <PageHeader title={`Edit ${order.number}`} description="Only DRAFT orders can be edited." />
      <Card className="p-5">
        <SalesOrderForm action={saveSalesOrderAction} initial={order} references={references} />
      </Card>
    </ResponsiveContainer>
  );
}
