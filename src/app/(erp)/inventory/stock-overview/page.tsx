import { readableInventoryQuantity } from "@/components/inventory/quantity-display";
import { PageHeader } from "@/components/layout/page-header";
import { MasterSearch, SearchPagination } from "@/components/master-data/search-pagination";
import { Card } from "@/components/ui/card";
import { ResponsiveContainer } from "@/components/ui/responsive-container";
import { parseInventoryPage } from "@/modules/inventory/application/listing";
import { requirePermission } from "@/server/auth/server-guards";
import { PrismaInventoryRepository } from "@/server/inventory/prisma-inventory-repository";

export default async function StockOverviewPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string }>;
}) {
  await requirePermission("inventory.view");
  const params = await searchParams;
  const query = params.q?.trim().slice(0, 120) ?? "";
  const page = parseInventoryPage(params.page);
  const repository = new PrismaInventoryRepository();
  const [result, units] = await Promise.all([
    repository.listStockOverview(query, page),
    repository.listPostingUnits(),
  ]);
  return (
    <ResponsiveContainer>
      <PageHeader
        title="Stock Overview"
        description="Current quantities calculated from immutable signed movements. No editable balance row exists."
      />
      <MasterSearch defaultValue={query} route="/inventory/stock-overview" />
      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[72rem] text-left text-sm">
            <thead className="bg-[var(--surface)]">
              <tr>
                <th className="p-4">Item</th>
                <th className="p-4">Type</th>
                <th className="p-4">Warehouse</th>
                <th className="p-4">Available</th>
                <th className="p-4">Other statuses</th>
                <th className="p-4">Total physical</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {result.records.map((row) => {
                const unit = units.find(
                  (candidate) => candidate.code === row.canonicalUnitCode,
                ) ?? {
                  id: row.canonicalUnitCode,
                  code: row.canonicalUnitCode,
                  name: row.canonicalUnitCode,
                  symbol: row.canonicalUnitSymbol,
                  dimension: row.canonicalUnitDimension,
                  active: true,
                };
                const displayUnits = units.some((candidate) => candidate.code === unit.code)
                  ? units
                  : [...units, unit];
                const display = (quantity: string) =>
                  readableInventoryQuantity({
                    quantity,
                    unit,
                    availableUnits: displayUnits,
                    piecesPerCarton: row.piecesPerCarton,
                  });
                return (
                  <tr key={`${row.itemId}:${row.warehouseId}:${row.canonicalUnitCode}`}>
                    <td className="p-4">
                      <strong>{row.itemCode}</strong>
                      <span className="block text-xs text-[var(--muted)]">{row.itemName}</span>
                    </td>
                    <td className="p-4 text-xs">{row.itemType.replaceAll("_", " ")}</td>
                    <td className="p-4">{row.warehouseName}</td>
                    <td className="p-4 font-medium">{display(row.availableQuantity)}</td>
                    <td className="p-4">{display(row.otherStatusQuantity)}</td>
                    <td className="p-4 font-semibold">{display(row.totalQuantity)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <SearchPagination
          page={result.page}
          pageCount={result.pageCount}
          query={query}
          route="/inventory/stock-overview"
          total={result.total}
        />
      </Card>
    </ResponsiveContainer>
  );
}
