import Link from "next/link";
import { notFound } from "next/navigation";
import { CustomerForm } from "@/components/sales/customer-form";
import { PageHeader } from "@/components/layout/page-header";
import { Card } from "@/components/ui/card";
import { ResponsiveContainer } from "@/components/ui/responsive-container";
import { SalesStatusForm } from "@/components/sales/sales-status-form";
import { hasPermission } from "@/modules/access/domain/principal";
import { requirePermission } from "@/server/auth/server-guards";
import { PrismaSalesRepository } from "@/server/sales/prisma-sales-repository";
import { PrismaCustomerPaymentRepository } from "@/server/sales/prisma-customer-payment-repository";
import { getCustomerReceivableSnapshot } from "@/server/sales/credit-exposure";
import { saveCustomerAction, setCustomerStatusAction } from "../../actions";
export default async function CustomerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const principal = await requirePermission("sales.view");
  const repository = new PrismaSalesRepository();
  const paymentRepository = new PrismaCustomerPaymentRepository();
  const customerId = (await params).id;
  const [customer, references] = await Promise.all([
    repository.getCustomer(customerId),
    repository.getReferenceData(false),
  ]);
  if (!customer) notFound();
  const [receivables, aging] = await Promise.all([
    getCustomerReceivableSnapshot(customer.id),
    paymentRepository.getCustomerAging(customer.id),
  ]);
  const canManage = hasPermission(principal, "sales.manage");
  return (
    <ResponsiveContainer>
      <PageHeader
        title={`${customer.code} — ${customer.name}`}
        description={`${customer.active ? "Active" : "Inactive"} customer details`}
      />
      <div className="mb-4 flex flex-wrap gap-3">
        <Link
          className="rounded-lg border px-4 py-2 text-sm"
          href={`/sales/customers/${customer.id}/statement`}
        >
          Customer statement
        </Link>
        <Link
          className="rounded-lg border px-4 py-2 text-sm"
          href={`/sales/invoices?customer=${customer.id}`}
        >
          Invoices
        </Link>
        <Link
          className="rounded-lg border px-4 py-2 text-sm"
          href={`/sales/payments?customer=${customer.id}`}
        >
          Payments
        </Link>
        <Link
          className="rounded-lg border px-4 py-2 text-sm"
          href={`/sales/returns?customer=${customer.id}`}
        >
          Returns
        </Link>
        {canManage && (
          <Link
            className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm text-white"
            href={`/sales/payments/new?customer=${customer.id}`}
          >
            New payment
          </Link>
        )}
      </div>
      <Card className="mb-5 grid gap-4 p-5 md:grid-cols-2 xl:grid-cols-3">
        <Info label="Contact" value={customer.contactPerson ?? "-"} />
        <Info
          label="Phone"
          value={[customer.phone, customer.secondaryPhone].filter(Boolean).join(" / ")}
        />
        <Info label="Email" value={customer.email ?? "-"} />
        <Info
          label="Address"
          value={[customer.address, customer.city].filter(Boolean).join(", ")}
        />
        <Info label="Tax / registration" value={customer.taxRegistrationNo ?? "-"} />
        <Info label="Customer group" value={customer.customerGroupName ?? "-"} />
        <Info
          label="Area / route"
          value={[customer.areaName, customer.routeName].filter(Boolean).join(" / ")}
        />
        <Info label="Salesperson" value={customer.salespersonName ?? "-"} />
        <Info label="Credit limit" value={customer.creditLimit ?? "-"} />
        <Info label="Current balance" value={receivables.outstanding} />
        <Info label="Available credit" value={receivables.availableCredit ?? "No configured cap"} />
        <Info label="Unallocated credit" value={receivables.unallocatedCredit} />
        <Info label="Overdue invoices" value={aging.overdue} />
        <Info
          label="Payment terms"
          value={customer.paymentTermsDays === null ? "-" : `${customer.paymentTermsDays} days`}
        />
        <Info label="Notes" value={customer.notes ?? "-"} />
        {canManage && (
          <SalesStatusForm
            action={setCustomerStatusAction}
            id={customer.id}
            active={customer.active}
          />
        )}
      </Card>
      <Card className="mb-5 overflow-x-auto p-5">
        <h2 className="font-semibold">Open invoices and aging</h2>
        <p className="mt-2 text-sm">
          Current {aging.current} · 1–30 {aging.days1To30} · 31–60 {aging.days31To60} · 61–90{" "}
          {aging.days61To90} · 90+ {aging.days90Plus}
        </p>
        {receivables.invoices.length ? (
          <table className="mt-3 w-full min-w-[45rem] text-sm">
            <thead>
              <tr>
                <th>Invoice</th>
                <th>Date</th>
                <th>Due</th>
                <th>Original</th>
                <th>Outstanding</th>
                <th>Days overdue</th>
              </tr>
            </thead>
            <tbody>
              {receivables.invoices
                .filter((invoice) => Number(invoice.outstanding) > 0)
                .map((invoice) => (
                  <tr className="border-t" key={invoice.id}>
                    <td>
                      <Link className="text-[var(--accent)]" href={`/sales/invoices/${invoice.id}`}>
                        {invoice.number}
                      </Link>
                    </td>
                    <td>{invoice.invoiceDate.toLocaleDateString()}</td>
                    <td>{invoice.dueDate.toLocaleDateString()}</td>
                    <td>{invoice.amount}</td>
                    <td>{invoice.outstanding}</td>
                    <td>{invoice.daysDue}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        ) : (
          <p className="mt-2 text-sm text-[var(--muted)]">No posted invoices.</p>
        )}
      </Card>
      <Card className="mb-5 overflow-x-auto p-5">
        <h2 className="font-semibold">Recent payments</h2>
        {receivables.recentPayments.length ? (
          <table className="mt-3 w-full text-sm">
            <thead>
              <tr>
                <th>Receipt</th>
                <th>Date</th>
                <th>Amount</th>
                <th>Unallocated</th>
              </tr>
            </thead>
            <tbody>
              {receivables.recentPayments.map((payment) => (
                <tr className="border-t" key={payment.id}>
                  <td>
                    <Link className="text-[var(--accent)]" href={`/sales/payments/${payment.id}`}>
                      {payment.number}
                    </Link>
                  </td>
                  <td>{payment.paymentDate.toLocaleDateString()}</td>
                  <td>{payment.amount}</td>
                  <td>{payment.unallocatedAmount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="mt-2 text-sm text-[var(--muted)]">No posted payments.</p>
        )}
      </Card>
      <Card className="mb-5 overflow-x-auto p-5">
        <h2 className="font-semibold">Recent return credits</h2>
        {receivables.recentReturnCredits.length ? (
          <table className="mt-3 w-full text-sm">
            <thead>
              <tr>
                <th>Return</th>
                <th>Date</th>
                <th>Credit</th>
              </tr>
            </thead>
            <tbody>
              {receivables.recentReturnCredits.map((salesReturn) => (
                <tr className="border-t" key={salesReturn.id}>
                  <td>
                    <Link
                      className="text-[var(--accent)]"
                      href={`/sales/returns/${salesReturn.id}`}
                    >
                      {salesReturn.number}
                    </Link>
                  </td>
                  <td>{salesReturn.returnDate.toLocaleDateString()}</td>
                  <td>{salesReturn.amount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="mt-2 text-sm text-[var(--muted)]">No completed return credits.</p>
        )}
      </Card>
      {canManage && (
        <Card className="p-5">
          <h2 className="mb-4 font-semibold">Edit customer</h2>
          <CustomerForm action={saveCustomerAction} initial={customer} references={references} />
        </Card>
      )}
    </ResponsiveContainer>
  );
}
function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-[var(--muted)]">{label}</dt>
      <dd className="mt-1 text-sm">{value}</dd>
    </div>
  );
}
