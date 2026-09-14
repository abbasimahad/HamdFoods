import { notFound, redirect } from "next/navigation";
import { PurchaseInvoiceForm } from "@/components/purchasing/purchase-invoice-form";
import { PageHeader } from "@/components/layout/page-header";
import { Card } from "@/components/ui/card";
import { ResponsiveContainer } from "@/components/ui/responsive-container";
import { requirePermission } from "@/server/auth/server-guards";
import { PrismaPurchaseInvoiceRepository } from "@/server/purchasing/prisma-purchase-invoice-repository";
import { savePurchaseInvoiceAction } from "../../actions";

export default async function EditPurchaseInvoicePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requirePermission("purchasing.manage");
  const repository = new PrismaPurchaseInvoiceRepository();
  const record = await repository.getPurchaseInvoice((await params).id);
  if (!record) notFound();
  if (record.status !== "DRAFT") redirect(`/purchasing/purchase-invoices/${record.id}`);
  const [poLines, grnLines] = await Promise.all([
    repository.listEligiblePurchaseOrderLines(),
    repository.listEligibleGoodsReceiptLines(),
  ]);
  return (
    <ResponsiveContainer>
      <PageHeader
        title={`Edit ${record.number}`}
        description="Only draft invoice details can be changed."
      />
      <Card className="p-5">
        <PurchaseInvoiceForm
          action={savePurchaseInvoiceAction}
          poLines={poLines}
          grnLines={grnLines}
          initial={record}
        />
      </Card>
    </ResponsiveContainer>
  );
}
