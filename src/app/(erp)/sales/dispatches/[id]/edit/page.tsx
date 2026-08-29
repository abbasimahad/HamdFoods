import { notFound, redirect } from "next/navigation";
import { SalesDispatchForm } from "@/components/sales/sales-dispatch-form";
import { PageHeader } from "@/components/layout/page-header";
import { Card } from "@/components/ui/card";
import { ResponsiveContainer } from "@/components/ui/responsive-container";
import { requirePermission } from "@/server/auth/server-guards";
import { PrismaSalesDispatchRepository } from "@/server/sales/prisma-sales-dispatch-repository";
import { saveSalesDispatchAction } from "../../actions";
export default async function EditSalesDispatchPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requirePermission("sales.manage");
  const repository = new PrismaSalesDispatchRepository();
  const dispatch = await repository.getSalesDispatch((await params).id);
  if (!dispatch) notFound();
  if (dispatch.status !== "DRAFT") redirect(`/sales/dispatches/${dispatch.id}`);
  const [references, order] = await Promise.all([
    repository.getSalesDispatchReferences(),
    repository.getDispatchOrder(dispatch.salesOrderId),
  ]);
  return (
    <ResponsiveContainer>
      <PageHeader
        title={`Edit ${dispatch.number}`}
        description="Only draft dispatches can be edited. Posting is separately protected and revalidates every allocation."
      />
      <Card className="p-5">
        <SalesDispatchForm
          action={saveSalesDispatchAction}
          initial={dispatch}
          order={order}
          references={references}
        />
      </Card>
    </ResponsiveContainer>
  );
}
