import Decimal from "decimal.js";
import { notFound } from "next/navigation";
import { PrintCompanyHeader } from "@/components/administration/print-company-header";
import { PrintButton } from "@/components/purchasing/print-button";
import { formatDocumentDate, formatQuantity } from "@/components/ui/format-money";
import { PrismaCompanyProfileRepository } from "@/server/administration/prisma-company-profile-repository";
import { requirePermission } from "@/server/auth/server-guards";
import { prisma } from "@/server/db/prisma";

/** Gate pass for a warehouse transfer: the linked TRANSFER_OUT / TRANSFER_IN movement pair. */
export default async function Page({ params }: { params: Promise<{ groupId: string }> }) {
  await requirePermission("inventory.view");
  const { groupId } = await params;
  if (!/^[0-9a-f-]{36}$/.test(groupId)) notFound();
  const [movements, companyProfile] = await Promise.all([
    prisma.inventoryMovement.findMany({
      where: { groupId, movementType: { in: ["TRANSFER_OUT", "TRANSFER_IN"] } },
      include: {
        item: true,
        warehouse: true,
        canonicalUnit: true,
        createdBy: true,
        inventoryLot: true,
        productionLot: true,
      },
    }),
    new PrismaCompanyProfileRepository().getCompanyProfile(),
  ]);
  const outs = movements.filter((movement) => movement.movementType === "TRANSFER_OUT");
  const out = outs[0];
  const into = movements.find((movement) => movement.movementType === "TRANSFER_IN");
  if (!out || !into) notFound();
  return (
    <main className="mx-auto max-w-4xl bg-white p-8 text-black print:p-0">
      <div className="mb-4 flex justify-end">
        <PrintButton label="Print gate pass" />
      </div>
      <PrintCompanyHeader profile={companyProfile} />
      <header className="mb-6 flex justify-between border-b pb-4">
        <div>
          <h1 className="text-2xl font-bold">Stock Transfer Gate Pass</h1>
          <p className="font-mono">{out.referenceId ?? groupId.slice(0, 8).toUpperCase()}</p>
        </div>
        <div className="text-right text-sm">
          <p>Date: {formatDocumentDate(out.postedAt)}</p>
          <p>Posted by: {out.createdBy.name}</p>
        </div>
      </header>
      <section className="mb-6 grid grid-cols-2 gap-4 text-sm">
        <div className="rounded border p-3">
          <strong>From</strong>
          <p>{out.warehouse.name}</p>
        </div>
        <div className="rounded border p-3">
          <strong>To</strong>
          <p>{into.warehouse.name}</p>
        </div>
      </section>
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr>
            {["Item", "Lot", "Stock status", "Quantity"].map((heading) => (
              <th className="border border-slate-400 p-2 text-left" key={heading}>
                {heading}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {outs.map((line) => (
            <tr key={line.id}>
              <td className="border p-2">
                {line.item.code} — {line.item.name}
              </td>
              <td className="border p-2">
                {line.productionLot?.lotNumber ?? line.inventoryLot?.supplierLotNumber ?? "—"}
              </td>
              <td className="border p-2">{line.status.replaceAll("_", " ")}</td>
              <td className="border p-2 text-right">
                {formatQuantity(new Decimal(line.quantity.toString()).abs())}{" "}
                {line.canonicalUnit.symbol}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-4 text-sm">Reason: {out.reason}</p>
      <section className="mt-16 grid grid-cols-3 gap-8 text-center text-xs">
        {["Issued by", "Carried by", "Received by"].map((label) => (
          <div className="border-t border-slate-500 pt-2" key={label}>
            {label}
          </div>
        ))}
      </section>
    </main>
  );
}
