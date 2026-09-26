import { notFound } from "next/navigation";
import { PrintButton } from "@/components/purchasing/print-button";
import { PrismaCompanyProfileRepository } from "@/server/administration/prisma-company-profile-repository";
import { requirePermission } from "@/server/auth/server-guards";
import { prisma } from "@/server/db/prisma";

export default async function PrintSupplierPaymentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requirePermission("accounting.view");
  const [payment, companyProfile] = await Promise.all([
    prisma.supplierPayment.findUnique({
      where: { id: (await params).id },
      include: {
        supplier: true,
        treasuryAccount: true,
        allocations: { include: { payableLedgerEntry: true } },
        postedBy: true,
        reversalOf: true,
        reversalPayment: true,
      },
    }),
    new PrismaCompanyProfileRepository().getCompanyProfile(),
  ]);
  if (!payment) notFound();
  const reversed = Boolean(payment.reversalPayment);
  return (
    <main className="mx-auto max-w-4xl bg-white p-8 text-slate-950 print:max-w-none print:p-0">
      <div className="mb-6 flex justify-end">
        <PrintButton />
      </div>
      <header className="mb-8 flex justify-between border-b-2 border-slate-900 pb-5">
        <div>
          <h1 className="text-2xl font-bold">{companyProfile.legalName}</h1>
          <p>Supplier Payment Voucher</p>
          {(companyProfile.address || companyProfile.city) && (
            <p className="text-xs text-slate-600">
              {[companyProfile.address, companyProfile.city].filter(Boolean).join(", ")}
            </p>
          )}
        </div>
        <div className="text-right">
          <strong className="text-xl">{payment.number}</strong>
          <p>{payment.paymentDate.toLocaleDateString()}</p>
          <p>{reversed ? `${payment.status} (REVERSED)` : payment.status}</p>
        </div>
      </header>
      {reversed && (
        <p className="mb-4 border-2 border-red-700 p-3 text-center text-lg font-bold tracking-wide text-red-700">
          REVERSED — NOT VALID FOR PAYMENT PROOF (see voucher {payment.reversalPayment!.number})
        </p>
      )}
      {payment.reversalOf && (
        <p className="mb-4 text-sm text-slate-600">
          This is a reversal of voucher {payment.reversalOf.number}.
        </p>
      )}
      <section className="mb-6 grid grid-cols-2 gap-8 text-sm">
        <div>
          <h2 className="mb-2 font-bold">Supplier</h2>
          <p>
            {payment.supplier.code} - {payment.supplier.name}
          </p>
        </div>
        <div>
          <p>
            <strong>Method:</strong> {payment.method} via {payment.treasuryAccount.name}
          </p>
          <p>
            <strong>Amount:</strong> {payment.totalAmount.toString()}
          </p>
          <p>
            <strong>Reference:</strong> {payment.referenceNumber ?? "-"}
          </p>
        </div>
      </section>
      <table className="w-full border-collapse text-xs">
        <thead>
          <tr>
            {["Allocated payable", "Amount"].map((heading) => (
              <th className="border border-slate-400 p-2 text-left" key={heading}>
                {heading}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {payment.allocations.map((allocation) => (
            <tr key={allocation.id}>
              <td className="border p-2">
                {allocation.payableLedgerEntry.sourceNumber ??
                  allocation.payableLedgerEntry.sourceId}
              </td>
              <td className="border p-2">{allocation.allocatedAmount.toString()}</td>
            </tr>
          ))}
          {payment.allocations.length === 0 && (
            <tr>
              <td className="border p-2" colSpan={2}>
                No invoice allocation; full amount recorded as supplier advance.
              </td>
            </tr>
          )}
        </tbody>
      </table>
      <section className="mt-8 border-t pt-4 text-sm">
        <p>
          Posted:{" "}
          {payment.postedAt
            ? `${payment.postedBy?.name ?? "-"} on ${payment.postedAt.toLocaleString()}`
            : "Not posted"}
        </p>
      </section>
    </main>
  );
}
