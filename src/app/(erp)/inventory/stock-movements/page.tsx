import Link from "next/link";

import { readableInventoryQuantity } from "@/components/inventory/quantity-display";
import { PageHeader } from "@/components/layout/page-header";
import { Card } from "@/components/ui/card";
import { ResponsiveContainer } from "@/components/ui/responsive-container";
import { parseMovementHistoryQuery } from "@/modules/inventory/application/listing";
import { INVENTORY_MOVEMENT_TYPES, INVENTORY_STATUSES } from "@/modules/inventory/domain/inventory";
import { requirePermission } from "@/server/auth/server-guards";
import { PrismaInventoryRepository } from "@/server/inventory/prisma-inventory-repository";

type Params = Record<string, string | string[] | undefined>;

export default async function StockMovementsPage({
  searchParams,
}: {
  searchParams: Promise<Params>;
}) {
  await requirePermission("inventory.view");
  const raw = await searchParams;
  const query = parseMovementHistoryQuery(raw);
  const repository = new PrismaInventoryRepository();
  const [result, warehouses, units] = await Promise.all([
    repository.listMovementHistory(query),
    repository.listActiveWarehouses(),
    repository.listPostingUnits(),
  ]);
  return (
    <ResponsiveContainer>
      <PageHeader
        title="Stock Movements"
        description="Immutable signed-canonical inventory history. Movements cannot be edited or deleted."
      />
      <Card className="mb-5 p-4">
        <form className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6" method="get">
          <FilterInput defaultValue={query.query} label="Item code/name" name="q" />
          <FilterSelect
            defaultValue={query.warehouseId}
            label="Warehouse"
            name="warehouseId"
            options={warehouses.map((row) => ({ value: row.id, label: row.name }))}
          />
          <FilterSelect
            defaultValue={query.status}
            label="Status"
            name="status"
            options={INVENTORY_STATUSES.map((value) => ({
              value,
              label: value.replaceAll("_", " "),
            }))}
          />
          <FilterSelect
            defaultValue={query.movementType}
            label="Movement"
            name="movementType"
            options={INVENTORY_MOVEMENT_TYPES.map((value) => ({
              value,
              label: value.replaceAll("_", " "),
            }))}
          />
          <FilterInput
            defaultValue={scalar(raw.dateFrom)}
            label="From date"
            name="dateFrom"
            type="date"
          />
          <FilterInput
            defaultValue={scalar(raw.dateTo)}
            label="To date"
            name="dateTo"
            type="date"
          />
          <button
            className="min-h-11 rounded-lg bg-[var(--accent)] px-4 text-sm font-semibold text-white sm:col-span-2 xl:col-span-1"
            type="submit"
          >
            Apply filters
          </button>
        </form>
      </Card>
      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[82rem] text-left text-sm">
            <thead className="bg-[var(--surface)]">
              <tr>
                {[
                  "Posted",
                  "Item",
                  "Warehouse",
                  "Status",
                  "Movement",
                  "Quantity",
                  "Reference",
                  "User",
                  "Reason",
                ].map((label) => (
                  <th className="p-4" key={label}>
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {result.records.map((movement) => {
                const unit = units.find(
                  (candidate) => candidate.code === movement.canonicalUnitCode,
                ) ?? {
                  id: movement.canonicalUnitCode,
                  code: movement.canonicalUnitCode,
                  name: movement.canonicalUnitCode,
                  symbol: movement.canonicalUnitSymbol,
                  dimension: movement.canonicalUnitDimension,
                  active: true,
                };
                const displayUnits = units.some((candidate) => candidate.code === unit.code)
                  ? units
                  : [...units, unit];
                return (
                  <tr key={movement.id}>
                    <td className="whitespace-nowrap p-4">{movement.postedAt.toLocaleString()}</td>
                    <td className="p-4">
                      <strong>{movement.itemCode}</strong>
                      <span className="block text-xs text-[var(--muted)]">{movement.itemName}</span>
                    </td>
                    <td className="p-4">{movement.warehouseName}</td>
                    <td className="p-4 text-xs">{movement.status.replaceAll("_", " ")}</td>
                    <td className="p-4 text-xs">{movement.movementType.replaceAll("_", " ")}</td>
                    <td className="whitespace-nowrap p-4 font-medium">
                      {readableInventoryQuantity({
                        quantity: movement.quantity,
                        unit,
                        availableUnits: displayUnits,
                        piecesPerCarton: movement.piecesPerCarton,
                        showSign: true,
                      })}
                    </td>
                    <td className="p-4 text-xs">
                      {movement.referenceType}
                      {movement.referenceId ? ` · ${movement.referenceId}` : ""}
                      {movement.supplierLotNumber ? (
                        <span className="block">Lot: {movement.supplierLotNumber}</span>
                      ) : null}
                    </td>
                    <td className="p-4">{movement.userName}</td>
                    <td className="max-w-64 p-4 text-[var(--muted)]">{movement.reason}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <HistoryPagination
          page={result.page}
          pageCount={result.pageCount}
          raw={raw}
          total={result.total}
        />
      </Card>
    </ResponsiveContainer>
  );
}

function FilterInput({
  label,
  name,
  defaultValue,
  type = "text",
}: {
  label: string;
  name: string;
  defaultValue?: string | undefined;
  type?: string;
}) {
  return (
    <label className="text-xs font-medium">
      {label}
      <input
        className="mt-1 min-h-11 w-full rounded-lg border border-[var(--border)] px-3 text-sm"
        defaultValue={defaultValue}
        name={name}
        type={type}
      />
    </label>
  );
}
function FilterSelect({
  label,
  name,
  defaultValue,
  options,
}: {
  label: string;
  name: string;
  defaultValue?: string | undefined;
  options: readonly { value: string; label: string }[];
}) {
  return (
    <label className="text-xs font-medium">
      {label}
      <select
        className="mt-1 min-h-11 w-full rounded-lg border border-[var(--border)] bg-white px-3 text-sm"
        defaultValue={defaultValue ?? ""}
        name={name}
      >
        <option value="">All</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}
function HistoryPagination({
  page,
  pageCount,
  total,
  raw,
}: {
  page: number;
  pageCount: number;
  total: number;
  raw: Params;
}) {
  const href = (target: number) => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(raw))
      if (typeof value === "string" && key !== "page" && value) params.set(key, value);
    params.set("page", String(target));
    return `?${params}`;
  };
  return (
    <div className="flex items-center justify-between border-t border-[var(--border)] p-4 text-sm">
      <span>{total} movements</span>
      <div className="flex gap-2">
        {page > 1 && (
          <Link className="rounded border px-3 py-2" href={href(page - 1)}>
            Previous
          </Link>
        )}
        <span className="px-2 py-2">
          {page} / {pageCount}
        </span>
        {page < pageCount && (
          <Link className="rounded border px-3 py-2" href={href(page + 1)}>
            Next
          </Link>
        )}
      </div>
    </div>
  );
}
function scalar(value: string | string[] | undefined) {
  return typeof value === "string" ? value : undefined;
}
