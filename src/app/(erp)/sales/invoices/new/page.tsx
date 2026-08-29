import { PageHeader } from "@/components/layout/page-header";
import { Card } from "@/components/ui/card";
import { ResponsiveContainer } from "@/components/ui/responsive-container";
import { requirePermission } from "@/server/auth/server-guards";
import { PrismaSalesInvoiceRepository } from "@/server/sales/prisma-sales-invoice-repository";
import { SalesInvoiceForm } from "@/components/sales/sales-invoice-form";
import { saveInvoiceAction } from "../actions";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ order?: string }>;
}) {
  await requirePermission("sales.manage");
  const r = new PrismaSalesInvoiceRepository();
  const id = (await searchParams).order;
  return (
    <ResponsiveContainer>
      <PageHeader
        title="New Sales Invoice"
        description="Invoice only posted dispatch quantities."
      />
      <Card className="p-5">
        <SalesInvoiceForm
          action={saveInvoiceAction}
          references={await r.getSalesInvoiceReferences()}
          order={id ? await r.getInvoiceSourceOrder(id) : null}
        />
      </Card>
    </ResponsiveContainer>
  );
}
