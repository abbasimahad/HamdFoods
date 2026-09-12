import { CustomerPaymentForm } from "@/components/sales/customer-payment-form";
import { PageHeader } from "@/components/layout/page-header";
import { Card } from "@/components/ui/card";
import { ResponsiveContainer } from "@/components/ui/responsive-container";
import { requirePermission } from "@/server/auth/server-guards";
import { PrismaCustomerPaymentRepository } from "@/server/sales/prisma-customer-payment-repository";
import { PrismaSalesRepository } from "@/server/sales/prisma-sales-repository";
import { saveCustomerPaymentAction } from "../actions";
export default async function NewCustomerPaymentPage({
  searchParams,
}: {
  searchParams: Promise<{ customer?: string; returnTo?: string }>;
}) {
  await requirePermission("sales.manage");
  const repository = new PrismaCustomerPaymentRepository();
  const salesReferences = await new PrismaSalesRepository().getReferenceData(true);
  const query = await searchParams;
  const customerId = query.customer;
  return (
    <ResponsiveContainer>
      <PageHeader
        title="New Customer Payment"
        description="Create a draft receipt and review manual or oldest-first allocation before posting."
      />
      <Card className="p-5">
        <CustomerPaymentForm
          action={saveCustomerPaymentAction}
          cancelHref={safeReturnTo(query.returnTo)}
          customerId={customerId}
          invoices={customerId ? await repository.getOpenInvoices(customerId) : []}
          quickCreateReferences={{
            groups: salesReferences.groups,
            areas: salesReferences.areas,
            routes: salesReferences.routes,
            salespersons: salesReferences.salespersons,
          }}
          references={await repository.getCustomerPaymentReferences()}
        />
      </Card>
    </ResponsiveContainer>
  );
}
function safeReturnTo(value?: string) {
  return value?.startsWith("/accounting/receivables/") && !value.startsWith("//")
    ? value
    : "/sales/payments";
}
