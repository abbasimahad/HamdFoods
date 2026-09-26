import { notFound } from "next/navigation";
import { PrintButton } from "@/components/purchasing/print-button";
import { PrismaCompanyProfileRepository } from "@/server/administration/prisma-company-profile-repository";
import { requirePermission } from "@/server/auth/server-guards";
import { PrismaPurchaseInvoiceRepository } from "@/server/purchasing/prisma-purchase-invoice-repository";

export default async function PrintPurchaseInvoicePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requirePermission("purchasing.view");
  const [record, companyProfile] = await Promise.all([
    new PrismaPurchaseInvoiceRepository().getPurchaseInvoice((await params).id),
    new PrismaCompanyProfileRepository().getCompanyProfile(),
  ]);
  if (!record) notFound();
  return (
    <main className="mx-auto max-w-5xl bg-white p-8 text-slate-950 print:max-w-none print:p-0">
      <div className="mb-6 flex justify-end">
        <PrintButton />
      </div>
      <header className="mb-8 flex justify-between border-b-2 border-slate-900 pb-5">
        <div>
          <h1 className="text-2xl font-bold">{companyProfile.legalName}</h1>
          <p>Purchase Invoice</p>
          {(companyProfile.address || companyProfile.city) && (
            <p className="text-xs text-slate-600">
              {[companyProfile.address, companyProfile.city].filter(Boolean).join(", ")}
            </p>
          )}
          {companyProfile.taxRegistrationNo && (
            <p className="text-xs text-slate-600">
              Tax registration: {companyProfile.taxRegistrationNo}
            </p>
          )}
        </div>
        <div className="text-right">
          <strong className="text-xl">{record.number}</strong>
          <p>{record.invoiceDate.toLocaleDateString()}</p>
          <p>{record.status}</p>
        </div>
      </header>
      <section className="mb-6 grid grid-cols-2 gap-8 text-sm">
        <div>
          <h2 className="mb-2 font-bold">Supplier</h2>
          <p>
            {record.supplierCode} - {record.supplierName}
          </p>
        </div>
        <div>
          <p>
            <strong>Supplier invoice number:</strong> {record.supplierInvoiceNumber}
          </p>
          <p>
            <strong>Due date:</strong> {record.dueDate?.toLocaleDateString() ?? "-"}
          </p>
          <p>
            <strong>Created by:</strong> {record.createdByName}
          </p>
        </div>
      </section>
      <table className="w-full border-collapse text-xs">
        <thead>
          <tr>
            {["Item", "Purchase order", "Invoiced", "Rate", "Tax %", "Net"].map((heading) => (
              <th className="border border-slate-400 p-2 text-left" key={heading}>
                {heading}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {record.lines.map((line) => (
            <tr key={line.id}>
              <td className="border p-2">
                {line.itemCode} - {line.itemName}
              </td>
              <td className="border p-2">{line.purchaseOrderNumber}</td>
              <td className="border p-2">
                {line.invoicedQuantity} {line.canonicalUnitSymbol}
              </td>
              <td className="border p-2">{line.invoicedUnitRate}</td>
              <td className="border p-2">{line.taxPercent}</td>
              <td className="border p-2">{line.netAmount}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <dl className="ml-auto mt-5 grid max-w-sm grid-cols-2 gap-2 text-sm">
        <dt>Subtotal</dt>
        <dd className="text-right">{record.subtotal}</dd>
        <dt>Tax</dt>
        <dd className="text-right">{record.taxTotal}</dd>
        <dt className="font-bold">Grand total</dt>
        <dd className="text-right font-bold">{record.grandTotal}</dd>
      </dl>
      <section className="mt-8 border-t pt-4 text-sm">
        <strong>Notes</strong>
        <p className="whitespace-pre-wrap">{record.notes ?? "-"}</p>
        <p className="mt-6">
          Posted:{" "}
          {record.postedAt
            ? `${record.postedByName} on ${record.postedAt.toLocaleString()}`
            : "Not posted"}
        </p>
      </section>
    </main>
  );
}
