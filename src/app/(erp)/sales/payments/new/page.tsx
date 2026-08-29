import { CustomerPaymentForm } from "@/components/sales/customer-payment-form";
import { PageHeader } from "@/components/layout/page-header";
import { Card } from "@/components/ui/card";
import { ResponsiveContainer } from "@/components/ui/responsive-container";
import { requirePermission } from "@/server/auth/server-guards";
import { PrismaCustomerPaymentRepository } from "@/server/sales/prisma-customer-payment-repository";
import { saveCustomerPaymentAction } from "../actions";
export default async function NewCustomerPaymentPage({
  searchParams,
}: {
  searchParams: Promise<{ customer?: string }>;
}) {
  await requirePermission("sales.manage");
  const repository = new PrismaCustomerPaymentRepository();
  const customerId = (await searchParams).customer;
  return (
    <ResponsiveContainer>
      <PageHeader
        title="New Customer Payment"
        description="Create a draft receipt and review manual or oldest-first allocation before posting."
      />
      <Card className="p-5">
        <CustomerPaymentForm
          action={saveCustomerPaymentAction}
          customerId={customerId}
          invoices={customerId ? await repository.getOpenInvoices(customerId) : []}
          references={await repository.getCustomerPaymentReferences()}
        />
      </Card>
    </ResponsiveContainer>
  );
}
