import { notFound, redirect } from "next/navigation";
import { PurchaseReturnForm } from "@/components/purchasing/purchase-return-form";
import { PageHeader } from "@/components/layout/page-header";
import { Card } from "@/components/ui/card";
import { ResponsiveContainer } from "@/components/ui/responsive-container";
import { requirePermission } from "@/server/auth/server-guards";
import { PrismaPurchaseReturnRepository } from "@/server/purchasing/prisma-purchase-return-repository";
import { savePurchaseReturnAction } from "../../actions";
export default async function EditPurchaseReturnPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requirePermission("purchasing.manage");
  const repository = new PrismaPurchaseReturnRepository();
  const record = await repository.getPurchaseReturn((await params).id);
  if (!record) notFound();
  if (record.status !== "DRAFT") redirect(`/purchasing/purchase-returns/${record.id}`);
  const [sources, units] = await Promise.all([
    repository.listEligibleReturnSources(),
    repository.listReturnUnits(),
  ]);
  return (
    <ResponsiveContainer>
      <PageHeader
        title={`Edit ${record.number}`}
        description="Only draft return details can be changed."
      />
      <Card className="p-5">
        <PurchaseReturnForm
          action={savePurchaseReturnAction}
          sources={sources}
          units={units}
          initial={record}
        />
      </Card>
    </ResponsiveContainer>
  );
}
