import Link from "next/link";
import { PageHeader } from "@/components/layout/page-header";
import { Card } from "@/components/ui/card";
import { ResponsiveContainer } from "@/components/ui/responsive-container";
import { hasPermission } from "@/modules/access/domain/principal";
import { RECIPE_STATUSES } from "@/modules/production/application/contracts";
import {
  parseRecipePage,
  parseRecipeStatus,
  parseRecipeVersion,
} from "@/modules/production/application/recipe-listing";
import { requirePermission } from "@/server/auth/server-guards";
import { PrismaRecipeRepository } from "@/server/production/prisma-recipe-repository";

type Params = {
  q?: string;
  finishedGood?: string;
  status?: string;
  version?: string;
  page?: string;
};
export default async function RecipesPage({ searchParams }: { searchParams: Promise<Params> }) {
  const principal = await requirePermission("production.view");
  const params = await searchParams;
  const repository = new PrismaRecipeRepository();
  const page = parseRecipePage(params.page);
  const [result, items] = await Promise.all([
    repository.listRecipes({
      page,
      query: params.q?.trim().slice(0, 120) ?? "",
      finishedGoodId: params.finishedGood || undefined,
      status: parseRecipeStatus(params.status),
      version: parseRecipeVersion(params.version),
    }),
    repository.listCatalogItems(),
  ]);
  const finishedGoods = items.filter((item) => item.itemType === "FINISHED_GOOD");
  const filters = {
    ...(params.q ? { q: params.q } : {}),
    ...(params.finishedGood ? { finishedGood: params.finishedGood } : {}),
    ...(params.status ? { status: params.status } : {}),
    ...(params.version ? { version: params.version } : {}),
  };
  return (
    <ResponsiveContainer>
      <PageHeader
        title="Recipes & Packaging BOMs"
        description="Versioned product formulations, standard batch scaling, expected yield, and packaging requirements."
      />
      {hasPermission(principal, "production.manage") && (
        <div className="mb-4 flex justify-end">
          <Link
            className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white"
            href="/production/recipes/new"
          >
            New recipe
          </Link>
        </div>
      )}
      <Card className="mb-4 p-4">
        <form className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          <input
            className="min-h-11 rounded-lg border px-3"
            defaultValue={params.q}
            name="q"
            placeholder="Recipe code, name, or product"
          />
          <select
            className="min-h-11 rounded-lg border bg-white px-3"
            defaultValue={params.finishedGood ?? ""}
            name="finishedGood"
          >
            <option value="">All finished goods</option>
            {finishedGoods.map((item) => (
              <option key={item.id} value={item.id}>
                {item.code} - {item.name}
              </option>
            ))}
          </select>
          <select
            className="min-h-11 rounded-lg border bg-white px-3"
            defaultValue={params.status ?? ""}
            name="status"
          >
            <option value="">All statuses</option>
            {RECIPE_STATUSES.map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
          </select>
          <input
            className="min-h-11 rounded-lg border px-3"
            defaultValue={params.version}
            min="1"
            name="version"
            placeholder="Version"
            type="number"
          />
          <button className="rounded-lg bg-[var(--accent)] px-4 font-semibold text-white">
            Filter
          </button>
        </form>
      </Card>
      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[75rem] text-left text-sm">
            <thead className="bg-[var(--surface)]">
              <tr>
                <th className="p-4">Recipe</th>
                <th className="p-4">Product</th>
                <th className="p-4">Version</th>
                <th className="p-4">Standard batch</th>
                <th className="p-4">Expected output</th>
                <th className="p-4">Status</th>
                <th className="p-4">Effective</th>
                <th className="p-4">Approved by</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {result.records.map((recipe) => (
                <tr key={recipe.id}>
                  <td className="p-4">
                    <Link
                      className="font-mono font-semibold text-[var(--accent)]"
                      href={`/production/recipes/${recipe.id}`}
                    >
                      {recipe.code}
                    </Link>
                    <span className="block text-xs">{recipe.name}</span>
                  </td>
                  <td className="p-4">
                    {recipe.finishedGoodCode} - {recipe.finishedGoodName}
                  </td>
                  <td className="p-4">v{recipe.version}</td>
                  <td className="p-4">
                    {recipe.standardBatchEnteredQuantity} {recipe.standardBatchUnitSymbol}
                  </td>
                  <td className="p-4">
                    {recipe.expectedOutputEnteredQuantity
                      ? `${recipe.expectedOutputEnteredQuantity} ${recipe.expectedOutputUnitSymbol}`
                      : "-"}
                  </td>
                  <td className="p-4">{recipe.status}</td>
                  <td className="p-4">{recipe.effectiveDate?.toLocaleDateString() ?? "-"}</td>
                  <td className="p-4">{recipe.approvedByName ?? "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Pagination
          page={result.page}
          pageCount={result.pageCount}
          total={result.total}
          filters={filters}
        />
      </Card>
    </ResponsiveContainer>
  );
}
function Pagination({
  page,
  pageCount,
  total,
  filters,
}: {
  page: number;
  pageCount: number;
  total: number;
  filters: Record<string, string>;
}) {
  const href = (target: number) =>
    `/production/recipes?${new URLSearchParams({ ...filters, page: String(target) })}`;
  return (
    <div className="flex items-center justify-between border-t p-4 text-sm">
      <span>
        {total} recipe versions - Page {page} of {pageCount}
      </span>
      <div className="flex gap-2">
        {page > 1 && (
          <Link className="rounded-lg border px-3 py-2" href={href(page - 1)}>
            Previous
          </Link>
        )}
        {page < pageCount && (
          <Link className="rounded-lg border px-3 py-2" href={href(page + 1)}>
            Next
          </Link>
        )}
      </div>
    </div>
  );
}
