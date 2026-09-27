import { notFound } from "next/navigation";
import { PrintCompanyHeader } from "@/components/administration/print-company-header";
import { PrintButton } from "@/components/purchasing/print-button";
import { formatDocumentDate, formatQuantity } from "@/components/ui/format-money";
import { PrismaCompanyProfileRepository } from "@/server/administration/prisma-company-profile-repository";
import { requirePermission } from "@/server/auth/server-guards";
import { PrismaProductionBatchRepository } from "@/server/production/prisma-production-batch-repository";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission("production.view");
  const [batch, companyProfile] = await Promise.all([
    new PrismaProductionBatchRepository().getBatch((await params).id),
    new PrismaCompanyProfileRepository().getCompanyProfile(),
  ]);
  if (!batch) notFound();
  return (
    <main className="mx-auto max-w-5xl bg-white p-8 text-black print:p-0">
      <div className="mb-4 flex justify-end">
        <PrintButton label="Print batch sheet" />
      </div>
      <PrintCompanyHeader profile={companyProfile} />
      <header className="mb-6 flex justify-between border-b pb-4">
        <div>
          <h1 className="text-2xl font-bold">Production Batch Sheet</h1>
          <p className="font-mono">{batch.batchNumber}</p>
          <p className="text-sm">Status: {batch.status.replaceAll("_", " ")}</p>
        </div>
        <div className="text-right text-sm">
          <p>Planned date: {formatDocumentDate(batch.plannedProductionDate)}</p>
          <p>Target completion: {formatDocumentDate(batch.targetCompletionDate)}</p>
          <p>
            Recipe: {batch.recipeCode} v{batch.recipeVersion}
          </p>
        </div>
      </header>
      <section className="mb-6 grid grid-cols-2 gap-4 text-sm">
        <div className="rounded border p-3">
          <strong>Product</strong>
          <p>
            {batch.finishedGoodCode} — {batch.finishedGoodName}
          </p>
          <p>
            Batch size: {formatQuantity(batch.plannedBatchEnteredQuantity)}{" "}
            {batch.plannedBatchUnitSymbol}
          </p>
          <p>
            Planned output: {formatQuantity(batch.plannedCartons)} cartons +{" "}
            {formatQuantity(batch.plannedLoosePieces)} loose (
            {formatQuantity(batch.plannedTotalPieces)} pieces)
          </p>
        </div>
        <div className="rounded border p-3">
          <strong>Warehouses</strong>
          <p>Raw material: {batch.rawMaterialWarehouseName}</p>
          <p>Packaging: {batch.packagingWarehouseName}</p>
          <p>Finished goods to: {batch.finishedGoodsDestinationWarehouseName}</p>
        </div>
      </section>
      <h2 className="mb-2 font-semibold">Raw materials</h2>
      <table className="mb-6 w-full border-collapse text-xs">
        <thead>
          <tr>
            {[
              "#",
              "Material",
              "Standard",
              "Planned",
              "Issue (incl. allowance)",
              "Issued by",
              "Checked",
            ].map((heading) => (
              <th className="border border-slate-400 p-2 text-left" key={heading}>
                {heading}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {batch.materialRequirements.map((line) => (
            <tr key={line.id}>
              <td className="border p-2">{line.sequence}</td>
              <td className="border p-2">
                {line.itemCode} — {line.itemName}
              </td>
              <td className="border p-2 text-right">
                {formatQuantity(line.standardNormalizedQuantity)} {line.canonicalUnitSymbol}
              </td>
              <td className="border p-2 text-right">
                {formatQuantity(line.plannedNormalizedQuantity)} {line.canonicalUnitSymbol}
              </td>
              <td className="border p-2 text-right">
                {formatQuantity(line.recommendedIssueQuantity)} {line.canonicalUnitSymbol}
              </td>
              <td className="border p-2" />
              <td className="border p-2" />
            </tr>
          ))}
        </tbody>
      </table>
      <h2 className="mb-2 font-semibold">Packaging</h2>
      <table className="w-full border-collapse text-xs">
        <thead>
          <tr>
            {[
              "#",
              "Packaging item",
              "Basis",
              "Required",
              "Issue (incl. allowance)",
              "Issued by",
            ].map((heading) => (
              <th className="border border-slate-400 p-2 text-left" key={heading}>
                {heading}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {batch.packagingRequirements.map((line) => (
            <tr key={line.id}>
              <td className="border p-2">{line.sequence}</td>
              <td className="border p-2">
                {line.itemCode} — {line.itemName}
              </td>
              <td className="border p-2">{line.usageBasis.replaceAll("_", " ")}</td>
              <td className="border p-2 text-right">
                {formatQuantity(line.standardRequiredQuantity)} {line.canonicalUnitSymbol}
              </td>
              <td className="border p-2 text-right">
                {formatQuantity(line.recommendedIssueQuantity)} {line.canonicalUnitSymbol}
              </td>
              <td className="border p-2" />
            </tr>
          ))}
        </tbody>
      </table>
      {batch.notes ? <p className="mt-6 text-sm">Notes: {batch.notes}</p> : null}
      <section className="mt-16 grid grid-cols-3 gap-8 text-center text-xs">
        {["Production manager", "Store keeper", "Quality control"].map((label) => (
          <div className="border-t border-slate-500 pt-2" key={label}>
            {label}
          </div>
        ))}
      </section>
    </main>
  );
}
