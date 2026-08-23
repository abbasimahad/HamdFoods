import { RecipeForm } from "@/components/production/recipe-form";
import { PageHeader } from "@/components/layout/page-header";
import { Card } from "@/components/ui/card";
import { ResponsiveContainer } from "@/components/ui/responsive-container";
import { requirePermission } from "@/server/auth/server-guards";
import { PrismaRecipeRepository } from "@/server/production/prisma-recipe-repository";
import { saveRecipeAction } from "../actions";
export default async function NewRecipePage() {
  await requirePermission("production.manage");
  const repository = new PrismaRecipeRepository();
  const [items, units] = await Promise.all([
    repository.listCatalogItems(),
    repository.listRecipeUnits(),
  ]);
  return (
    <ResponsiveContainer>
      <PageHeader
        title="New Recipe"
        description="Create a versioned DRAFT formulation and Packaging BOM without changing inventory."
      />
      <Card className="p-5">
        <RecipeForm action={saveRecipeAction} items={items} units={units} />
      </Card>
    </ResponsiveContainer>
  );
}
