import Link from "next/link";
import { PageHeader } from "@/components/layout/page-header";
import { Card } from "@/components/ui/card";
import { ResponsiveContainer } from "@/components/ui/responsive-container";
import { hasPermission } from "@/modules/access/domain/principal";
import { PRODUCTION_BATCH_STATUSES } from "@/modules/production/application/batch-contracts";
import {
  parseProductionBatchDate,
  parseProductionBatchPage,
  parseProductionBatchStatus,
} from "@/modules/production/application/batch-listing";
import { requirePermission } from "@/server/auth/server-guards";
import { PrismaProductionBatchRepository } from "@/server/production/prisma-production-batch-repository";

type Params = {
  q?: string;
  finishedGood?: string;
  recipe?: string;
  status?: string;
  date?: string;
  page?: string;
};

export default async function ProductionBatchesPage({
  searchParams,
}: {
  searchParams: Promise<Params>;
}) {
  const principal = await requirePermission("production.view");
  const params = await searchParams;
  const repository = new PrismaProductionBatchRepository();
  const [result, recipes] = await Promise.all([
    repository.listBatches({
      page: parseProductionBatchPage(params.page),
      query: params.q?.trim().slice(0, 120) ?? "",
      finishedGoodId: params.finishedGood || undefined,
      recipeId: params.recipe || undefined,
      status: parseProductionBatchStatus(params.status),
      date: parseProductionBatchDate(params.date),
    }),
    repository.listApprovedRecipes(),
  ]);
  const finishedGoods = [
    ...new Map(
      recipes.map((recipe) => [
        recipe.finishedGoodId,
        { id: recipe.finishedGoodId, code: recipe.finishedGoodCode, name: recipe.finishedGoodName },
      ]),
    ).values(),
  ];
  const filters = Object.fromEntries(
    Object.entries(params).filter(
      ([key, value]) => key !== "page" && typeof value === "string" && value !== "",
    ),
  ) as Record<string, string>;
  return (
    <ResponsiveContainer>
      <PageHeader
        title="Production Batches"
        description="Recipe-based production plans, requirement snapshots, availability, and controlled release."
      />
      {hasPermission(principal, "production.manage") && (
        <div className="mb-4 flex justify-end">
          <Link
            className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white"
            href="/production/batches/new"
          >
            New batch
          </Link>
        </div>
      )}
      <Card className="mb-4 p-4">
        <form className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
          <input
            className="min-h-11 rounded-lg border px-3"
            defaultValue={params.q}
            name="q"
            placeholder="Batch number or product"
          />
          <select
            className="min-h-11 rounded-lg border bg-white px-3"
            defaultValue={params.finishedGood ?? ""}
            name="finishedGood"
          >
            <option value="">All products</option>
            {finishedGoods.map((item) => (
              <option key={item.id} value={item.id}>
                {item.code} - {item.name}
              </option>
            ))}
          </select>
          <select
            className="min-h-11 rounded-lg border bg-white px-3"
            defaultValue={params.recipe ?? ""}
            name="recipe"
          >
            <option value="">All active recipes</option>
            {recipes.map((recipe) => (
              <option key={recipe.id} value={recipe.id}>
                {recipe.code} v{recipe.version}
              </option>
            ))}
          </select>
          <select
            className="min-h-11 rounded-lg border bg-white px-3"
            defaultValue={params.status ?? ""}
            name="status"
          >
            <option value="">All statuses</option>
            {PRODUCTION_BATCH_STATUSES.map((status) => (
              <option key={status}>{status}</option>
            ))}
          </select>
          <input
            className="min-h-11 rounded-lg border px-3"
            defaultValue={params.date}
            name="date"
            type="date"
          />
          <button className="rounded-lg bg-[var(--accent)] px-4 font-semibold text-white">
            Filter
          </button>
        </form>
      </Card>
      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[78rem] text-left text-sm">
            <thead className="bg-[var(--surface)]">
              <tr>
                <th className="p-4">Batch</th>
                <th className="p-4">Product</th>
                <th className="p-4">Recipe</th>
                <th className="p-4">Planned date</th>
                <th className="p-4">Batch quantity</th>
                <th className="p-4">Expected output</th>
                <th className="p-4">Status</th>
                <th className="p-4">Created by</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {result.records.map((batch) => (
                <tr key={batch.id}>
                  <td className="p-4">
                    <Link
                      className="font-mono font-semibold text-[var(--accent)]"
                      href={`/production/batches/${batch.id}`}
                    >
                      {batch.batchNumber}
                    </Link>
                  </td>
                  <td className="p-4">
                    {batch.finishedGoodCode} - {batch.finishedGoodName}
                  </td>
                  <td className="p-4">
                    {batch.recipeCode} v{batch.recipeVersion}
                  </td>
                  <td className="p-4">{batch.plannedProductionDate.toLocaleDateString()}</td>
                  <td className="p-4">
                    {batch.plannedBatchEnteredQuantity} {batch.plannedBatchUnitSymbol}
                  </td>
                  <td className="p-4">
                    {batch.plannedExpectedOutputNormalizedQuantity
                      ? `${batch.plannedExpectedOutputNormalizedQuantity} ${batch.expectedOutputCanonicalSymbol}`
                      : "-"}
                  </td>
                  <td className="p-4">
                    {batch.status}
                    {batch.hasShortage && (
                      <span className="ml-2 text-xs text-amber-700">SHORTAGE</span>
                    )}
                  </td>
                  <td className="p-4">{batch.createdByName}</td>
                </tr>
              ))}
              {result.records.length === 0 && (
                <tr>
                  <td className="p-6 text-[var(--muted)]" colSpan={8}>
                    No production batches match these filters.
                  </td>
                </tr>
              )}
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
    `/production/batches?${new URLSearchParams({ ...filters, page: String(target) })}`;
  return (
    <div className="flex items-center justify-between border-t p-4 text-sm">
      <span>
        {total} batches - Page {page} of {pageCount}
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
