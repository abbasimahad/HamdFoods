import { formatFactoryDate } from "@/components/ui/format-datetime";
import { PrintButton } from "@/components/purchasing/print-button";
import Decimal from "decimal.js";
import { notFound } from "next/navigation";
import { PrintCompanyHeader } from "@/components/administration/print-company-header";
import { formatDocumentDate, formatMoney, formatQuantity } from "@/components/ui/format-money";
import { PrismaCompanyProfileRepository } from "@/server/administration/prisma-company-profile-repository";
import { requirePermission } from "@/server/auth/server-guards";
import { PrismaSalesInvoiceRepository } from "@/server/sales/prisma-sales-invoice-repository";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission("sales.view");
  const [x, companyProfile] = await Promise.all([
    new PrismaSalesInvoiceRepository().getSalesInvoice((await params).id),
    new PrismaCompanyProfileRepository().getCompanyProfile(),
  ]);
  if (!x) notFound();
  const taxed = new Decimal(x.taxTotal).gt(0);
  return (
    <main className="mx-auto max-w-5xl bg-white p-8 text-black print:p-0">
      <div className="mb-4 flex justify-end print:hidden">
        <PrintButton label="Print invoice" />
      </div>
      <PrintCompanyHeader profile={companyProfile} />
      <header className="mb-6 flex justify-between border-b pb-4">
        <div>
          <h1 className="text-2xl font-bold">{taxed ? "Sales Tax Invoice" : "Sales Invoice"}</h1>
          <p className="font-mono">{x.number}</p>
          {x.status !== "POSTED" ? (
            <p className="mt-1 font-semibold text-red-700">{x.status} — not a valid tax invoice</p>
          ) : null}
        </div>
        <div className="text-right text-sm">
          <p>Invoice date: {formatDocumentDate(x.invoiceDate)}</p>
          <p>Due date: {formatDocumentDate(x.dueDate)}</p>
          <p>Sales order: {x.salesOrderNumber}</p>
        </div>
      </header>
      <section className="mb-6 grid grid-cols-2 gap-4 text-sm">
        <div className="rounded border p-3">
          <strong>Supplier (seller)</strong>
          <p>{companyProfile.legalName}</p>
          <p>NTN / STRN: {companyProfile.taxRegistrationNo || "—"}</p>
        </div>
        <div className="rounded border p-3">
          <strong>Buyer</strong>
          <p>
            {x.customerName} ({x.customerCode})
          </p>
          <p>{x.billingAddress}</p>
          {x.customerPhone ? <p>Phone: {x.customerPhone}</p> : null}
          <p>NTN / STRN: {x.customerTaxRegistrationNo || "Unregistered"}</p>
        </div>
      </section>
      <table className="w-full border-collapse text-xs">
        <thead>
          <tr>
            {[
              "#",
              "Product",
              "Lot / expiry",
              "Qty (pcs)",
              "Rate / carton",
              "Discount",
              "Value excl. tax",
              "Tax %",
              "Sales tax",
              "Value incl. tax",
            ].map((heading) => (
              <th className="border border-slate-400 p-2 text-left" key={heading}>
                {heading}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {x.lines.map((l, index) => {
            const valueExclTax = new Decimal(l.grossAmount).minus(l.discountAmount);
            return (
              <tr key={l.id}>
                <td className="border p-2">{index + 1}</td>
                <td className="border p-2">
                  {l.itemCode} — {l.itemName}
                  <span className="block text-[10px] text-slate-600">
                    {formatQuantity(l.cartons)} ctn + {formatQuantity(l.loosePieces)} pcs
                  </span>
                </td>
                <td className="border p-2">
                  {l.allocations.length
                    ? l.allocations.map((lot) => (
                        <span className="block" key={lot.lotNumber}>
                          {lot.lotNumber}
                          {lot.expiryDate ? ` / exp. ${formatFactoryDate(lot.expiryDate)}` : ""} (
                          {formatQuantity(lot.quantity)})
                        </span>
                      ))
                    : "—"}
                </td>
                <td className="border p-2 text-right">{formatQuantity(l.totalPieces)}</td>
                <td className="border p-2 text-right">{formatMoney(l.cartonRate, "")}</td>
                <td className="border p-2 text-right">{formatMoney(l.discountAmount, "")}</td>
                <td className="border p-2 text-right">{formatMoney(valueExclTax, "")}</td>
                <td className="border p-2 text-right">{formatQuantity(l.taxPercent)}%</td>
                <td className="border p-2 text-right">{formatMoney(l.taxAmount, "")}</td>
                <td className="border p-2 text-right">{formatMoney(l.netAmount, "")}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <dl className="ml-auto mt-5 grid max-w-sm grid-cols-2 gap-1 text-sm">
        <dt>Gross value</dt>
        <dd className="text-right">{formatMoney(x.subtotal)}</dd>
        <dt>Less discount</dt>
        <dd className="text-right">{formatMoney(x.discountTotal)}</dd>
        <dt>Value excluding tax</dt>
        <dd className="text-right">
          {formatMoney(new Decimal(x.subtotal).minus(x.discountTotal))}
        </dd>
        <dt>Sales tax</dt>
        <dd className="text-right">{formatMoney(x.taxTotal)}</dd>
        <dt className="border-t pt-1 font-bold">Total payable</dt>
        <dd className="border-t pt-1 text-right font-bold">{formatMoney(x.grandTotal)}</dd>
      </dl>
      {x.notes && <p className="mt-6 text-sm">Notes: {x.notes}</p>}
      <section className="mt-16 grid grid-cols-3 gap-8 text-center text-xs">
        {["Prepared by", "Checked by", "Received by (customer)"].map((label) => (
          <div className="border-t border-slate-500 pt-2" key={label}>
            {label}
          </div>
        ))}
      </section>
    </main>
  );
}
