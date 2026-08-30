import Link from "next/link";
import {
  CancelDocumentForm,
  PostDocumentForm,
  SupplierPaymentForm,
} from "@/components/accounting/phase23-forms";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/layout/page-header";
import { ResponsiveContainer } from "@/components/ui/responsive-container";
import { hasPermission } from "@/modules/access/domain/principal";
import { requirePermission } from "@/server/auth/server-guards";
import { supplierPaymentPage } from "@/server/accounting/prisma-phase23-repository";
export default async function Page() {
  const principal = await requirePermission("accounting.view");
  const page = await supplierPaymentPage();
  return (
    <ResponsiveContainer>
      <PageHeader
        title="Supplier Payments"
        description="Posted payments reduce AP once; allocations settle payable items without another cash posting."
      />
      {hasPermission(principal, "accounting.manage") ? (
        <Card className="mb-4 p-4">
          <SupplierPaymentForm suppliers={page.suppliers} treasuries={page.treasuries} />
        </Card>
      ) : null}
      <Card className="overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr>
              <th className="p-3 text-left">Payment</th>
              <th className="p-3 text-left">Date</th>
              <th className="p-3 text-left">Supplier</th>
              <th className="p-3 text-left">Treasury</th>
              <th className="p-3 text-left">Amount</th>
              <th className="p-3 text-left">Allocated / advance</th>
              <th className="p-3 text-left">Status</th>
              <th className="p-3 text-left">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {page.payments.map((payment) => (
              <tr key={payment.id}>
                <td className="p-3">
                  <Link
                    className="text-[var(--accent)]"
                    href={`/purchasing/supplier-payments/${payment.id}`}
                  >
                    {payment.number}
                  </Link>
                </td>
                <td className="p-3">{payment.paymentDate.toISOString().slice(0, 10)}</td>
                <td className="p-3">{payment.supplier.name}</td>
                <td className="p-3">{payment.treasuryAccount.name}</td>
                <td className="p-3">{payment.totalAmount.toString()}</td>
                <td className="p-3">
                  {payment.allocated} / {payment.unallocated}
                </td>
                <td className="p-3">{payment.status}</td>
                <td className="p-3">
                  {payment.status === "DRAFT" && hasPermission(principal, "accounting.manage") ? (
                    <>
                      <PostDocumentForm id={payment.id} type="payment" />
                      <CancelDocumentForm id={payment.id} type="payment" />
                    </>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </ResponsiveContainer>
  );
}
