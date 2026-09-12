import { RecipeForm } from "@/components/production/recipe-form";
import { PageHeader } from "@/components/layout/page-header";
import { Card } from "@/components/ui/card";
import { ResponsiveContainer } from "@/components/ui/responsive-container";
import { requirePermission } from "@/server/auth/server-guards";
import { hasPermission } from "@/modules/access/domain/principal";
import { PrismaMasterDataRepository } from "@/server/master-data/prisma-master-data-repository";
import { PrismaRecipeRepository } from "@/server/production/prisma-recipe-repository";
import { saveRecipeAction } from "../actions";
export default async function NewRecipePage() {
  const principal = await requirePermission("production.manage");
  const repository = new PrismaRecipeRepository();
  const canCreateItems = hasPermission(principal, "inventory.manage");
  const masterRepository = new PrismaMasterDataRepository();
  const [items, units, productCategories, materialCategories, packagingCategories, masterUnits] =
    await Promise.all([
      repository.listCatalogItems(),
      repository.listRecipeUnits(),
      canCreateItems ? masterRepository.listActiveCategories("FINISHED_GOOD") : [],
      canCreateItems ? masterRepository.listActiveCategories("RAW_MATERIAL") : [],
      canCreateItems ? masterRepository.listActiveCategories("PACKAGING_MATERIAL") : [],
      canCreateItems ? masterRepository.listActiveUnits() : [],
    ]);
  return (
    <ResponsiveContainer>
      <PageHeader
        title="New Recipe"
        description="Create a versioned DRAFT formulation and Packaging BOM without changing inventory."
      />
      <Card className="p-5">
        <RecipeForm
          action={saveRecipeAction}
          items={items}
          quickCreateReferences={
            canCreateItems
              ? {
                  product: { categories: productCategories, units: masterUnits },
                  material: { categories: materialCategories, units: masterUnits },
                  packaging: { categories: packagingCategories, units: masterUnits },
                }
              : undefined
          }
          units={units}
        />
      </Card>
    </ResponsiveContainer>
  );
}
