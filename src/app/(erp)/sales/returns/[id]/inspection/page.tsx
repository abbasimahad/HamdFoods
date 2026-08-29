import { notFound, redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { Card } from "@/components/ui/card";
import { ResponsiveContainer } from "@/components/ui/responsive-container";
import { SalesReturnInspectionForm } from "@/components/sales/sales-return-inspection-form";
import { requirePermission } from "@/server/auth/server-guards";
import { PrismaSalesReturnRepository } from "@/server/sales/prisma-sales-return-repository";
import { inspectSalesReturnAction } from "../../actions";
export default async function SalesReturnInspectionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requirePermission("sales.manage");
  const salesReturn = await new PrismaSalesReturnRepository().getSalesReturn((await params).id);
  if (!salesReturn) notFound();
  if (salesReturn.status !== "RECEIVED") redirect(`/sales/returns/${salesReturn.id}`);
  return (
    <ResponsiveContainer>
      <PageHeader
        title={`Inspect ${salesReturn.number}`}
        description="Every returned line must classify exactly into resale, quarantine, reprocess, damaged, or expired stock."
      />
      <Card className="p-5">
        <SalesReturnInspectionForm action={inspectSalesReturnAction} salesReturn={salesReturn} />
      </Card>
    </ResponsiveContainer>
  );
}
