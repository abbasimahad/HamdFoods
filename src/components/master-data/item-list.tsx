import Link from "next/link";
import type {
  CategoryRecord,
  ItemRecord,
  UnitRecord,
} from "@/modules/master-data/application/contracts";
import type { ItemType } from "@/modules/master-data/domain/master-data";
import {
  calculateCartonContent,
  formatFinishedGoodContent,
} from "@/modules/quantity/domain/cartons";
import { QuantityDomainError } from "@/modules/quantity/domain/quantity";

import type { MasterAction } from "./action-state";
import { ItemForm } from "./item-form";
import { MasterStatusForm } from "./master-status-form";

export function ItemList({
  records,
  itemType,
  canManage,
  canViewRecipes,
  saveAction,
  statusAction,
  categories,
  units,
  contentUnits,
}: {
  records: readonly ItemRecord[];
  itemType: ItemType;
  canManage: boolean;
  canViewRecipes: boolean;
  saveAction: MasterAction;
  statusAction: MasterAction;
  categories: readonly CategoryRecord[];
  units: readonly UnitRecord[];
  contentUnits: readonly UnitRecord[];
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[64rem] text-left text-sm">
        <thead className="bg-[var(--surface)]">
          <tr>
            <th className="p-4">Code</th>
            <th className="p-4">Name</th>
            <th className="p-4">Category</th>
            <th className="p-4">Stock unit</th>
            {itemType === "PACKAGING_MATERIAL" && <th className="p-4">Kind</th>}
            {itemType === "FINISHED_GOOD" && <th className="p-4">Product definition</th>}
            <th className="p-4">Status</th>
            <th className="p-4">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--border)]">
          {records.map((item) => (
            <tr key={item.id}>
              <td className="p-4 font-mono text-xs">{item.code}</td>
              <td className="p-4">
                <strong className="block">{item.name}</strong>
                {item.description && (
                  <span className="block max-w-56 truncate text-xs text-[var(--muted)]">
                    {item.description}
                  </span>
                )}
              </td>
              <td className="p-4">{item.categoryName}</td>
              <td className="p-4">{item.stockUnitSymbol}</td>
              {itemType === "PACKAGING_MATERIAL" && (
                <td className="p-4 text-xs">{item.packagingKind?.replaceAll("_", " ")}</td>
              )}
              {itemType === "FINISHED_GOOD" && (
                <td className="p-4 text-xs">
                  <FinishedGoodDefinition item={item} units={contentUnits} />
                </td>
              )}
              <td className="p-4">{item.active ? "Active" : "Inactive"}</td>
              <td className="p-4">
                {itemType === "FINISHED_GOOD" && (
                  <Link
                    className="mb-2 block text-xs font-semibold text-[var(--accent)]"
                    href={`/inventory/valuation/${item.id}`}
                  >
                    Cost history
                  </Link>
                )}
                {itemType === "FINISHED_GOOD" && canViewRecipes && (
                  <Link
                    className="mb-2 block text-xs font-semibold text-[var(--accent)]"
                    href={`/production/recipes?finishedGood=${item.id}`}
                  >
                    Recipe history
                  </Link>
                )}
                {canManage && (
                  <div className="space-y-2">
                    <details>
                      <summary className="cursor-pointer text-xs font-semibold">Edit</summary>
                      <div className="mt-3 w-[58rem] max-w-[82vw]">
                        <ItemForm
                          action={saveAction}
                          categories={categories}
                          contentUnits={contentUnits}
                          initial={item}
                          itemType={itemType}
                          units={units}
                        />
                      </div>
                    </details>
                    <MasterStatusForm action={statusAction} active={item.active} id={item.id} />
                  </div>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function FinishedGoodDefinition({
  item,
  units,
}: {
  item: ItemRecord;
  units: readonly UnitRecord[];
}) {
  const profile = item.finishedGoodProfile;
  if (!profile) return "Invalid profile";
  let cartonContent: string;
  try {
    const content = calculateCartonContent({
      netContentQuantity: profile.netContentQuantity,
      netContentUnit: {
        code: profile.netContentUnitCode,
        symbol: profile.netContentUnitSymbol,
        dimension: profile.netContentUnitDimension,
        active: profile.netContentUnitActive,
      },
      netContentUnitDimension: profile.netContentUnitDimension,
      piecesPerCarton: profile.piecesPerCarton,
    });
    cartonContent = formatFinishedGoodContent(content, units);
  } catch (error) {
    if (error instanceof QuantityDomainError) return "Invalid profile";
    throw error;
  }
  return (
    <>
      <span className="block">
        {profile.netContentQuantity} {profile.netContentUnitSymbol} × {profile.piecesPerCarton}
      </span>
      <span className="mt-1 block text-[var(--muted)]">Carton content: {cartonContent}</span>
    </>
  );
}
