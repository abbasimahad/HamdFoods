import { notFound } from "next/navigation";
import { CustomerPaymentForm } from "@/components/sales/customer-payment-form";
import { PageHeader } from "@/components/layout/page-header";
import { Card } from "@/components/ui/card";
import { ResponsiveContainer } from "@/components/ui/responsive-container";
import { requirePermission } from "@/server/auth/server-guards";
import { PrismaCustomerPaymentRepository } from "@/server/sales/prisma-customer-payment-repository";
import { saveCustomerPaymentAction } from "../../actions";
export default async function EditCustomerPaymentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requirePermission("sales.manage");
  const repository = new PrismaCustomerPaymentRepository();
  const payment = await repository.getCustomerPayment((await params).id);
  if (!payment || payment.status !== "DRAFT") notFound();
  return (
    <ResponsiveContainer>
      <PageHeader
        title={`Edit ${payment.number}`}
        description="Draft allocations are revalidated against current invoice outstanding amounts before posting."
      />
      <Card className="p-5">
        <CustomerPaymentForm
          action={saveCustomerPaymentAction}
          initial={payment}
          invoices={await repository.getOpenInvoices(payment.customerId)}
          references={await repository.getCustomerPaymentReferences()}
        />
      </Card>
    </ResponsiveContainer>
  );
}
