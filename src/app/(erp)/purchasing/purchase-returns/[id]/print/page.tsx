import { notFound } from "next/navigation";
import { PrintButton } from "@/components/purchasing/print-button";
import { PrismaCompanyProfileRepository } from "@/server/administration/prisma-company-profile-repository";
import { requirePermission } from "@/server/auth/server-guards";
import { PrismaPurchaseReturnRepository } from "@/server/purchasing/prisma-purchase-return-repository";

export default async function PrintPurchaseReturnPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requirePermission("purchasing.view");
  const [record, companyProfile] = await Promise.all([
    new PrismaPurchaseReturnRepository().getPurchaseReturn((await params).id),
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
          <p>Purchase Return</p>
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
          <p>{record.returnDate.toLocaleDateString()}</p>
          <p>{record.status.replaceAll("_", " ")}</p>
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
            <strong>Purchase order:</strong> {record.purchaseOrderNumber}
          </p>
          <p>
            <strong>Original GRN:</strong> {record.originalGoodsReceiptNumber}
          </p>
          <p>
            <strong>Warehouse:</strong> {record.sourceWarehouseName}
          </p>
          <p>
            <strong>Supplier reference:</strong> {record.supplierReturnReference ?? "-"}
          </p>
          <p>
            <strong>Created by:</strong> {record.createdByName}
          </p>
        </div>
      </section>
      <table className="w-full border-collapse text-xs">
        <thead>
          <tr>
            {["Item", "Lot", "Returned", "Reason", "Replacement expected"].map((heading) => (
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
              <td className="border p-2">{line.supplierLotNumber ?? "Internal lot"}</td>
              <td className="border p-2">
                {line.enteredQuantity} {line.enteredUnitSymbol}
              </td>
              <td className="border p-2">{line.reason.replaceAll("_", " ")}</td>
              <td className="border p-2">{line.replacementExpected ? "Yes" : "No"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <section className="mt-8 border-t pt-4 text-sm">
        <strong>Notes</strong>
        <p className="whitespace-pre-wrap">{record.reasonNotes ?? "-"}</p>
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
