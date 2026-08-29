import { notFound } from "next/navigation";
import { SalesInvoiceForm } from "@/components/sales/sales-invoice-form";
import { PageHeader } from "@/components/layout/page-header";
import { Card } from "@/components/ui/card";
import { ResponsiveContainer } from "@/components/ui/responsive-container";
import { requirePermission } from "@/server/auth/server-guards";
import { PrismaSalesInvoiceRepository } from "@/server/sales/prisma-sales-invoice-repository";
import { saveInvoiceAction } from "../../actions";

export default async function EditSalesInvoicePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requirePermission("sales.manage");
  const repository = new PrismaSalesInvoiceRepository();
  const invoice = await repository.getSalesInvoice((await params).id);
  if (!invoice || invoice.status !== "DRAFT") notFound();
  const [references, order] = await Promise.all([
    repository.getSalesInvoiceReferences(),
    repository.getInvoiceSourceOrder(invoice.salesOrderId),
  ]);
  if (!order) notFound();
  return (
    <ResponsiveContainer>
      <PageHeader
        title={`Edit ${invoice.number}`}
        description="Draft quantities remain limited to uninvoiced posted-dispatch quantities."
      />
      <Card className="p-5">
        <SalesInvoiceForm
          action={saveInvoiceAction}
          references={references}
          order={order}
          initial={invoice}
        />
      </Card>
    </ResponsiveContainer>
  );
}
