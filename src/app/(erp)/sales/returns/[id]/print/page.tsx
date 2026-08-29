import { notFound } from "next/navigation";
import { requirePermission } from "@/server/auth/server-guards";
import { PrismaSalesReturnRepository } from "@/server/sales/prisma-sales-return-repository";
export default async function PrintSalesReturnPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requirePermission("sales.view");
  const salesReturn = await new PrismaSalesReturnRepository().getSalesReturn((await params).id);
  if (!salesReturn) notFound();
  return (
    <main className="mx-auto max-w-4xl p-8 text-sm print:p-0">
      <h1 className="text-2xl font-bold">Sales Return Note — {salesReturn.number}</h1>
      <p className="mt-2">
        Customer: {salesReturn.customerName} · Date: {salesReturn.returnAt.toLocaleDateString()} ·
        Dispatch: {salesReturn.salesDispatchNumber}
      </p>
      <p>Invoice: {salesReturn.salesInvoiceNumber ?? "Not invoiced — dispatch refusal"}</p>
      <table className="mt-6 w-full border-collapse">
        <thead>
          <tr className="border-b text-left">
            <th>Product</th>
            <th>Lot</th>
            <th>Cartons</th>
            <th>Loose</th>
            <th>Pieces</th>
            <th>Reason</th>
            <th>Inspection</th>
          </tr>
        </thead>
        <tbody>
          {salesReturn.lines.map((line) => (
            <tr className="border-b" key={line.id}>
              <td>
                {line.itemCode} — {line.itemName}
              </td>
              <td>{line.lotNumber}</td>
              <td>{line.cartons}</td>
              <td>{line.loosePieces}</td>
              <td>{line.totalPieces}</td>
              <td>{line.reason}</td>
              <td>
                {line.inspections
                  .map((inspection) => `${inspection.classification}: ${inspection.quantity}`)
                  .join(", ") || "Pending"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-6 font-semibold">
        {salesReturn.type === "INVOICED_RETURN"
          ? `Customer credit: ${salesReturn.creditAmount}`
          : "No financial credit — goods were not invoiced."}
      </p>
    </main>
  );
}
