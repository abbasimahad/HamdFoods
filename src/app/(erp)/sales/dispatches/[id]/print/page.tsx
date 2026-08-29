import { notFound } from "next/navigation";
import { requirePermission } from "@/server/auth/server-guards";
import { PrismaSalesDispatchRepository } from "@/server/sales/prisma-sales-dispatch-repository";
export default async function PrintSalesDispatchPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requirePermission("sales.view");
  const dispatch = await new PrismaSalesDispatchRepository().getSalesDispatch((await params).id);
  if (!dispatch) notFound();
  return (
    <main className="mx-auto max-w-5xl bg-white p-8 text-black print:max-w-none print:p-0">
      <header className="mb-8 flex justify-between border-b pb-5">
        <div>
          <h1 className="text-2xl font-bold">Delivery Note / Gate Pass</h1>
          <p>{dispatch.number}</p>
        </div>
        <div className="text-right text-sm">
          <p>Dispatch date: {dispatch.dispatchAt.toLocaleDateString()}</p>
          <p>Status: {dispatch.status}</p>
        </div>
      </header>
      <section className="mb-6 grid gap-4 text-sm md:grid-cols-3">
        <div>
          <strong>Customer</strong>
          <p>{dispatch.customerName}</p>
          <p>{dispatch.customerCode}</p>
          <p>{dispatch.deliveryAddress}</p>
        </div>
        <div>
          <strong>Sales Order</strong>
          <p>{dispatch.salesOrderNumber}</p>
          <p>Route: {dispatch.routeName ?? "-"}</p>
          <p>Salesperson: {dispatch.salespersonName ?? "-"}</p>
        </div>
        <div>
          <strong>Transport</strong>
          <p>Vehicle: {dispatch.vehicleNumber ?? "-"}</p>
          <p>Driver: {dispatch.driverName ?? "-"}</p>
          <p>Gate pass: {dispatch.gatePassReference ?? "-"}</p>
        </div>
      </section>
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-y">
            <th className="p-2 text-left">Product</th>
            <th className="p-2 text-right">Cartons</th>
            <th className="p-2 text-right">Loose</th>
            <th className="p-2 text-right">Pieces</th>
            <th className="p-2 text-left">Production lots</th>
          </tr>
        </thead>
        <tbody>
          {dispatch.lines.map((line) => (
            <tr className="border-b" key={line.id}>
              <td className="p-2">
                {line.itemCode} — {line.itemName}
              </td>
              <td className="p-2 text-right">{line.cartons}</td>
              <td className="p-2 text-right">{line.loosePieces}</td>
              <td className="p-2 text-right">{line.totalPieces}</td>
              <td className="p-2">
                {line.allocations.map((allocation) => (
                  <span className="block" key={`${allocation.id}-${allocation.quantity}`}>
                    {allocation.lotNumber}: {allocation.quantity} pcs
                    {allocation.expiryDate
                      ? ` (exp. ${new Date(allocation.expiryDate).toLocaleDateString()})`
                      : ""}
                  </span>
                ))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {dispatch.notes && (
        <section className="mt-8 text-sm">
          <strong>Notes</strong>
          <p>{dispatch.notes}</p>
        </section>
      )}
      <footer className="mt-10 grid grid-cols-2 gap-12 border-t pt-8 text-sm">
        <p>Prepared by: {dispatch.createdByName}</p>
        <p>Authorized / posted by: {dispatch.postedByName ?? "Pending posting"}</p>
        <p>Driver signature: ____________________</p>
        <p>Receiver signature: ____________________</p>
      </footer>
    </main>
  );
}
