import { SalesOrderForm } from "@/components/sales/sales-order-form";
import { PageHeader } from "@/components/layout/page-header";
import { Card } from "@/components/ui/card";
import { ResponsiveContainer } from "@/components/ui/responsive-container";
import { requirePermission } from "@/server/auth/server-guards";
import { PrismaSalesOrderRepository } from "@/server/sales/prisma-sales-order-repository";
import { saveSalesOrderAction } from "../actions";
export default async function NewSalesOrderPage() {
  await requirePermission("sales.manage");
  const references = await new PrismaSalesOrderRepository().getSalesOrderReferences();
  return (
    <ResponsiveContainer>
      <PageHeader
        title="New Sales Order"
        description="Create a draft. Approval later reserves AVAILABLE finished-goods stock."
      />
      <Card className="p-5">
        <SalesOrderForm action={saveSalesOrderAction} references={references} />
      </Card>
    </ResponsiveContainer>
  );
}
