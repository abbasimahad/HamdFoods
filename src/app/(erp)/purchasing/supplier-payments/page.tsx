import { formatMoney } from "@/components/ui/format-money";
import Link from "next/link";
import { CancelDocumentForm, PostDocumentForm } from "@/components/accounting/phase23-forms";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/layout/page-header";
import { ResponsiveContainer } from "@/components/ui/responsive-container";
import { hasPermission } from "@/modules/access/domain/principal";
import { requirePermission } from "@/server/auth/server-guards";
import { supplierPaymentPage } from "@/server/accounting/prisma-phase23-repository";
import { PageActions, primaryPageActionClass } from "@/components/ui/page-actions";
import { formatFactoryDate } from "@/components/ui/format-datetime";
export default async function Page() {
  const principal = await requirePermission("accounting.view");
  const page = await supplierPaymentPage();
  return (
    <ResponsiveContainer>
      <PageHeader
        title="Supplier Payments"
        description="Posted payments reduce AP once; allocations settle payable items without another cash posting."
        actions={
          hasPermission(principal, "accounting.manage") ? (
            <PageActions>
              <Link className={primaryPageActionClass} href="/purchasing/supplier-payments/new">
                + New Supplier Payment
              </Link>
            </PageActions>
          ) : null
        }
      />
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
                <td className="p-3">{formatFactoryDate(payment.paymentDate)}</td>
                <td className="p-3">{payment.supplier.name}</td>
                <td className="p-3">{payment.treasuryAccount.name}</td>
                <td className="p-3">
                  {payment.reversalOf
                    ? `-${formatMoney(payment.totalAmount, "")}`
                    : formatMoney(payment.totalAmount, "")}
                </td>
                <td className="p-3">
                  {formatMoney(payment.allocated, "")} / {formatMoney(payment.unallocated, "")}
                </td>
                <td className="p-3">
                  {/* BUG-36: a reversed payment and its reversal never read as two live payments. */}
                  {payment.reversalPayment ? (
                    <span className="font-semibold text-red-700">
                      REVERSED ({payment.reversalPayment.number})
                    </span>
                  ) : payment.reversalOf ? (
                    <span className="font-semibold text-red-700">
                      REVERSAL of {payment.reversalOf.number}
                    </span>
                  ) : (
                    payment.status
                  )}
                </td>
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
