import { SalesDispatchForm } from "@/components/sales/sales-dispatch-form";
import { PageHeader } from "@/components/layout/page-header";
import { Card } from "@/components/ui/card";
import { ResponsiveContainer } from "@/components/ui/responsive-container";
import { requirePermission } from "@/server/auth/server-guards";
import { PrismaSalesDispatchRepository } from "@/server/sales/prisma-sales-dispatch-repository";
import { saveSalesDispatchAction } from "../actions";
export default async function NewSalesDispatchPage({
  searchParams,
}: {
  searchParams: Promise<{ order?: string }>;
}) {
  await requirePermission("sales.manage");
  const repository = new PrismaSalesDispatchRepository();
  const orderId = (await searchParams).order;
  const [references, order] = await Promise.all([
    repository.getSalesDispatchReferences(),
    orderId ? repository.getDispatchOrder(orderId) : null,
  ]);
  return (
    <ResponsiveContainer>
      <PageHeader
        title="New Dispatch"
        description="Create a draft delivery note from an approved order. Posting moves allocated pieces from RESERVED to IN TRANSIT."
      />
      <Card className="p-5">
        <SalesDispatchForm action={saveSalesDispatchAction} order={order} references={references} />
      </Card>
    </ResponsiveContainer>
  );
}
