import Link from "next/link";
import {
  LandedCostForm,
  InitializeValuationForm,
  RebuildValuationForm,
  ValuationAdjustmentForm,
} from "@/components/costing/valuation-actions";
import { PageHeader } from "@/components/layout/page-header";
import { Card } from "@/components/ui/card";
import { ResponsiveContainer } from "@/components/ui/responsive-container";
import { hasPermission } from "@/modules/access/domain/principal";
import { formatCost } from "@/modules/costing/domain/costing";
import { requirePermission } from "@/server/auth/server-guards";
import { PrismaInventoryValuationRepository } from "@/server/costing/prisma-inventory-valuation-repository";
import {
  initializeValuationAction,
  postLandedCostAction,
  postValuationAdjustmentAction,
  rebuildValuationAction,
} from "./actions";

type Search = {
  q?: string;
  type?: "RAW_MATERIAL" | "PACKAGING_MATERIAL" | "FINISHED_GOOD";
  category?: string;
  active?: string;
  missing?: string;
};
export default async function InventoryValuationPage({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  const principal = await requirePermission("inventory.view");
  const canManage = hasPermission(principal, "inventory.manage");
  const params = await searchParams;
  const repository = new PrismaInventoryValuationRepository();
  const [records, references, issues, receipts] = await Promise.all([
    repository.listValuation({
      query: params.q?.trim() ?? "",
      itemType: params.type,
      categoryId: params.category,
      active:
        params.active === undefined || params.active === "" ? undefined : params.active === "true",
      missingOnly: params.missing === "true",
    }),
    repository.listValuationReferences(),
    canManage ? repository.listUnresolvedIssues() : Promise.resolve([]),
    canManage ? repository.listPostedGoodsReceipts() : Promise.resolve([]),
  ]);
  return (
    <ResponsiveContainer>
      <PageHeader
        title="Inventory Valuation"
        description="Company-wide moving weighted-average value by item. Physical location and status remain in the quantity ledger."
      />
      <Card className="mb-5 p-5">
        <form className="grid gap-3 md:grid-cols-5">
          <input
            className="rounded-lg border px-3 py-2"
            defaultValue={params.q ?? ""}
            name="q"
            placeholder="Item code or name"
          />
          <select
            className="rounded-lg border bg-white px-3 py-2"
            defaultValue={params.type ?? ""}
            name="type"
          >
            <option value="">All item types</option>
            <option value="RAW_MATERIAL">Raw material</option>
            <option value="PACKAGING_MATERIAL">Packaging</option>
            <option value="FINISHED_GOOD">Finished good</option>
          </select>
          <select
            className="rounded-lg border bg-white px-3 py-2"
            defaultValue={params.category ?? ""}
            name="category"
          >
            <option value="">All categories</option>
            {references.categories.map((row) => (
              <option key={row.id} value={row.id}>
                {row.name}
              </option>
            ))}
          </select>
          <select
            className="rounded-lg border bg-white px-3 py-2"
            defaultValue={params.active ?? ""}
            name="active"
          >
            <option value="">Active + inactive</option>
            <option value="true">Active</option>
            <option value="false">Inactive</option>
          </select>
          <label className="flex items-center gap-2 text-sm">
            <input
              defaultChecked={params.missing === "true"}
              name="missing"
              type="checkbox"
              value="true"
            />
            Missing basis only
          </label>
          <button className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white">
            Filter
          </button>
        </form>
      </Card>
      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[70rem] text-left text-sm">
            <thead className="bg-[var(--surface)]">
              <tr>
                <th className="p-3">Item</th>
                <th className="p-3">Type / category</th>
                <th className="p-3">Canonical quantity</th>
                <th className="p-3">Average cost</th>
                <th className="p-3">Inventory value</th>
                <th className="p-3">Missing basis</th>
                <th className="p-3">Last valuation</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {records.map((row) => (
                <tr key={row.itemId}>
                  <td className="p-3">
                    <Link
                      className="font-semibold text-[var(--accent)]"
                      href={`/inventory/valuation/${row.itemId}`}
                    >
                      {row.itemCode} — {row.itemName}
                    </Link>
                  </td>
                  <td className="p-3">
                    {row.itemType.replaceAll("_", " ")} / {row.categoryName}
                  </td>
                  <td className="p-3">
                    {row.canonicalQuantity} {row.canonicalUnitSymbol}
                  </td>
                  <td className="p-3">{formatCost(row.averageUnitCost, 6)}</td>
                  <td className="p-3">{formatCost(row.inventoryValue)}</td>
                  <td className="p-3">{row.missingBasisCount || "—"}</td>
                  <td className="p-3">{row.lastValuationAt?.toLocaleString() ?? "Not valued"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      {canManage && (
        <>
          <Card className="mt-5 space-y-4 p-5">
            <h2 className="font-semibold">Historical valuation rebuild</h2>
            <p className="text-sm text-[var(--muted)]">
              Processes unvalued ownership events chronologically with stable source keys; running
              it again cannot duplicate entries.
            </p>
            <RebuildValuationForm action={rebuildValuationAction} />
          </Card>
          <Card className="mt-5 space-y-4 p-5">
            <h2 className="font-semibold">Missing valuation basis</h2>
            <p className="text-sm text-[var(--muted)]">
              Enter the value still attributable to current owned inventory. Use zero only when the
              unresolved historical quantity has been fully exhausted.
            </p>
            {issues.length ? (
              issues.map((issue) => (
                <div className="space-y-2 border-t pt-3" key={issue.id}>
                  <p className="text-sm">
                    <strong>
                      {issue.itemCode} — {issue.itemName}
                    </strong>
                    : {issue.quantity} units; {issue.description}
                  </p>
                  <InitializeValuationForm action={initializeValuationAction} issue={issue} />
                </div>
              ))
            ) : (
              <p className="text-sm text-[var(--muted)]">No unresolved valuation basis.</p>
            )}
          </Card>
          <Card className="mt-5 space-y-4 p-5">
            <h2 className="font-semibold">Post landed cost</h2>
            <p className="text-sm text-[var(--muted)]">
              Capitalizes receipt-related acquisition cost without changing physical stock or
              purchase documents.
            </p>
            <LandedCostForm action={postLandedCostAction} receipts={receipts} />
          </Card>
          <Card className="mt-5 space-y-4 p-5">
            <h2 className="font-semibold">Monetary valuation adjustment</h2>
            <p className="text-sm text-[var(--muted)]">
              Records an authorized value-only correction with a reason and reference. It never
              changes physical quantity or rewrites prior valuation entries.
            </p>
            <ValuationAdjustmentForm action={postValuationAdjustmentAction} items={records} />
          </Card>
        </>
      )}
    </ResponsiveContainer>
  );
}
