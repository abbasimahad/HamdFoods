import { PageHeader } from "@/components/layout/page-header";
import { Card } from "@/components/ui/card";
import { ResponsiveContainer } from "@/components/ui/responsive-container";
import { hasPermission } from "@/modules/access/domain/principal";
import { parseListQuery } from "@/modules/master-data/application/listing";
import type { ItemType } from "@/modules/master-data/domain/master-data";
import {
  isCanonicalPieceUnit,
  isSupportedQuantityUnitCode,
} from "@/modules/quantity/domain/quantity";
import { PrismaMasterDataRepository } from "@/server/master-data/prisma-master-data-repository";
import { requirePermission } from "@/server/auth/server-guards";

import type { MasterAction } from "./action-state";
import { ItemForm } from "./item-form";
import { ItemList } from "./item-list";
import { MasterSearch, SearchPagination } from "./search-pagination";

export async function ItemMasterPage({
  title,
  description,
  route,
  itemType,
  searchParams,
  saveAction,
  statusAction,
}: {
  title: string;
  description: string;
  route: string;
  itemType: ItemType;
  searchParams: Promise<{ q?: string; page?: string }>;
  saveAction: MasterAction;
  statusAction: MasterAction;
}) {
  const principal = await requirePermission("inventory.view");
  const query = parseListQuery(await searchParams);
  const repository = new PrismaMasterDataRepository();
  const [result, categories, availableUnits, contentUnits] = await Promise.all([
    repository.listItems(itemType, query),
    repository.listActiveCategories(itemType),
    repository.listActiveUnits(),
    itemType === "FINISHED_GOOD"
      ? repository.listActiveUnits(["MASS", "VOLUME"])
      : Promise.resolve([]),
  ]);
  const units =
    itemType === "FINISHED_GOOD" ? availableUnits.filter(isCanonicalPieceUnit) : availableUnits;
  const supportedContentUnits = contentUnits.filter(
    (unit) => isSupportedQuantityUnitCode(unit.code) && unit.dimension !== "COUNT",
  );
  const canManage = hasPermission(principal, "inventory.manage");
  const canViewRecipes =
    itemType === "FINISHED_GOOD" && hasPermission(principal, "production.view");
  const hasBasePrerequisites = categories.length > 0 && units.length > 0;
  const hasContentUnit = itemType !== "FINISHED_GOOD" || supportedContentUnits.length > 0;
  return (
    <ResponsiveContainer>
      <PageHeader title={title} description={description} />
      {canManage && (
        <Card className="mb-5 p-5">
          <h2 className="mb-4 font-semibold">Create {title.toLowerCase().replace(/s$/, "")}</h2>
          {hasBasePrerequisites && hasContentUnit ? (
            <ItemForm
              action={saveAction}
              categories={categories}
              contentUnits={supportedContentUnits}
              itemType={itemType}
              units={units}
            />
          ) : (
            <p className="text-sm text-[var(--warning-ink)]">
              {!hasBasePrerequisites
                ? "Create active categories and units before adding items."
                : "Create an active mass or volume unit before adding finished goods."}
            </p>
          )}
        </Card>
      )}
      <MasterSearch defaultValue={query.query} route={route} />
      <Card className="overflow-hidden">
        <ItemList
          canManage={canManage}
          canViewRecipes={canViewRecipes}
          categories={categories}
          contentUnits={supportedContentUnits}
          itemType={itemType}
          records={result.records}
          saveAction={saveAction}
          statusAction={statusAction}
          units={units}
        />
        <SearchPagination
          page={result.page}
          pageCount={result.pageCount}
          query={query.query}
          route={route}
          total={result.total}
        />
      </Card>
    </ResponsiveContainer>
  );
}
