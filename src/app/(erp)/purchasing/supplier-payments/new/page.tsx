import { SupplierPaymentForm } from "@/components/accounting/phase23-forms";
import { PageHeader } from "@/components/layout/page-header";
import { Card } from "@/components/ui/card";
import { ResponsiveContainer } from "@/components/ui/responsive-container";
import { supplierPaymentPage } from "@/server/accounting/prisma-phase23-repository";
import { requirePermission } from "@/server/auth/server-guards";

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ supplier?: string; returnTo?: string }>;
}) {
  await requirePermission("accounting.manage");
  const [query, data] = await Promise.all([searchParams, supplierPaymentPage()]);
  return (
    <ResponsiveContainer>
      <PageHeader
        title="New Supplier Payment"
        description="Save a draft payment, then allocate and post it through the existing payable engine."
      />
      <Card className="p-5">
        <SupplierPaymentForm
          suppliers={data.suppliers}
          treasuries={data.treasuries}
          supplierId={query.supplier ?? ""}
          cancelHref={safeReturnTo(query.returnTo)}
        />
      </Card>
    </ResponsiveContainer>
  );
}
function safeReturnTo(value?: string) {
  return value?.startsWith("/accounting/payables/") && !value.startsWith("//")
    ? value
    : "/purchasing/supplier-payments";
}
