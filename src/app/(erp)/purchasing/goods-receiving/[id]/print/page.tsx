import { notFound } from "next/navigation";
import { PrintButton } from "@/components/purchasing/print-button";
import { PrismaCompanyProfileRepository } from "@/server/administration/prisma-company-profile-repository";
import { requirePermission } from "@/server/auth/server-guards";
import { PrismaGoodsReceiptRepository } from "@/server/purchasing/prisma-goods-receipt-repository";

export default async function PrintGoodsReceiptPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requirePermission("purchasing.view");
  const [receipt, companyProfile] = await Promise.all([
    new PrismaGoodsReceiptRepository().getGoodsReceipt((await params).id),
    new PrismaCompanyProfileRepository().getCompanyProfile(),
  ]);
  if (!receipt) notFound();
  return (
    <main className="mx-auto max-w-5xl bg-white p-8 text-slate-950 print:max-w-none print:p-0">
      <div className="mb-6 flex justify-end">
        <PrintButton />
      </div>
      <header className="mb-8 flex justify-between border-b-2 border-slate-900 pb-5">
        <div>
          <h1 className="text-2xl font-bold">{companyProfile.legalName}</h1>
          <p>Goods Receipt Note</p>
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
          <strong className="text-xl">{receipt.number}</strong>
          <p>{receipt.receiptDate.toLocaleString()}</p>
          <p>{receipt.status.replaceAll("_", " ")}</p>
        </div>
      </header>
      <section className="mb-6 grid grid-cols-2 gap-8 text-sm">
        <div>
          <h2 className="mb-2 font-bold">Supplier</h2>
          <p>
            {receipt.supplierCode} - {receipt.supplierName}
          </p>
        </div>
        <div>
          <p>
            <strong>Purchase order:</strong> {receipt.purchaseOrderNumber}
          </p>
          <p>
            <strong>Warehouse:</strong> {receipt.warehouseCode} - {receipt.warehouseName}
          </p>
          <p>
            <strong>Delivery / challan:</strong> {receipt.supplierDeliveryNumber ?? "-"}
          </p>
          <p>
            <strong>Vehicle / reference:</strong> {receipt.vehicleReference ?? "-"}
          </p>
          <p>
            <strong>Received by:</strong> {receipt.receivedByName}
          </p>
        </div>
      </section>
      <table className="w-full border-collapse text-xs">
        <thead>
          <tr>
            {["Item", "Ordered", "Received", "Supplier lot", "Expiry", "Accepted", "Rejected"].map(
              (heading) => (
                <th className="border border-slate-400 p-2 text-left" key={heading}>
                  {heading}
                </th>
              ),
            )}
          </tr>
        </thead>
        <tbody>
          {receipt.lines.map((line) => (
            <tr key={line.id}>
              <td className="border p-2">
                {line.itemCode} - {line.itemName}
              </td>
              <td className="border p-2">
                {line.orderedQuantity} {line.canonicalUnitSymbol}
              </td>
              <td className="border p-2">
                {line.enteredQuantity} {line.enteredUnitSymbol}
              </td>
              <td className="border p-2">{line.supplierLotNumber ?? "-"}</td>
              <td className="border p-2">{line.expiryDate?.toLocaleDateString() ?? "-"}</td>
              <td className="border p-2">
                {line.acceptedQuantity} {line.canonicalUnitSymbol}
              </td>
              <td className="border p-2">
                {line.rejectedQuantity} {line.canonicalUnitSymbol}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <section className="mt-8 border-t pt-4 text-sm">
        <strong>Notes</strong>
        <p className="whitespace-pre-wrap">{receipt.notes ?? "-"}</p>
        <p className="mt-6">
          Posted:{" "}
          {receipt.postedAt
            ? `${receipt.postedByName} on ${receipt.postedAt.toLocaleString()}`
            : "Not posted"}
        </p>
        {receipt.qcCompletedAt && (
          <p className="mt-2">
            QC completed: {receipt.qcByName} on {receipt.qcCompletedAt.toLocaleString()}
          </p>
        )}
      </section>
    </main>
  );
}
