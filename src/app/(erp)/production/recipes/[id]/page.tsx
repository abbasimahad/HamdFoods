import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ApproveRecipeForm,
  InactivateRecipeForm,
  NewRecipeVersionForm,
} from "@/components/production/recipe-actions";
import { RecipeCalculators } from "@/components/production/recipe-calculators";
import { PageHeader } from "@/components/layout/page-header";
import { Card } from "@/components/ui/card";
import { ResponsiveContainer } from "@/components/ui/responsive-container";
import { hasPermission } from "@/modules/access/domain/principal";
import { requirePermission } from "@/server/auth/server-guards";
import { PrismaRecipeRepository } from "@/server/production/prisma-recipe-repository";
import {
  approveRecipeAction,
  calculatePackagingAction,
  createNewRecipeVersionAction,
  inactivateRecipeAction,
  scaleRecipeAction,
} from "../actions";

export default async function RecipeDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const principal = await requirePermission("production.view");
  const repository = new PrismaRecipeRepository();
  const [recipe, units] = await Promise.all([
    repository.getRecipe((await params).id),
    repository.listRecipeUnits(),
  ]);
  if (!recipe) notFound();
  const canManage = hasPermission(principal, "production.manage");
  return (
    <ResponsiveContainer>
      <PageHeader
        title={`${recipe.code} v${recipe.version}`}
        description={`${recipe.status} formulation for ${recipe.finishedGoodName}`}
      />
      <div className="mb-4 flex flex-wrap gap-2">
        {canManage && recipe.status === "DRAFT" && (
          <Link
            className="rounded-lg border px-4 py-2 text-sm font-semibold"
            href={`/production/recipes/${recipe.id}/edit`}
          >
            Edit draft
          </Link>
        )}
        {canManage && recipe.status !== "DRAFT" && (
          <NewRecipeVersionForm action={createNewRecipeVersionAction} id={recipe.id} />
        )}
      </div>
      <Card className="mb-5 grid gap-4 p-5 md:grid-cols-2 xl:grid-cols-4">
        <Info label="Recipe" value={`${recipe.code} - ${recipe.name}`} />
        <Info
          label="Finished good"
          value={`${recipe.finishedGoodCode} - ${recipe.finishedGoodName}`}
        />
        <Info label="Version / status" value={`v${recipe.version} / ${recipe.status}`} />
        <Info
          label="Standard batch"
          value={`${recipe.standardBatchEnteredQuantity} ${recipe.standardBatchUnitSymbol} (${recipe.standardBatchNormalizedQuantity} ${recipe.standardBatchCanonicalSymbol})`}
        />
        <Info
          label="Expected output"
          value={
            recipe.expectedOutputEnteredQuantity
              ? `${recipe.expectedOutputEnteredQuantity} ${recipe.expectedOutputUnitSymbol}`
              : "Not specified"
          }
        />
        <Info
          label="Expected yield"
          value={
            recipe.expectedYieldPercent
              ? `${recipe.expectedYieldPercent}%`
              : "Not comparable across dimensions"
          }
        />
        <Info label="Effective date" value={recipe.effectiveDate?.toLocaleDateString() ?? "-"} />
        <Info label="Created by" value={recipe.createdByName} />
        <Info
          label="Approved"
          value={
            recipe.approvedAt
              ? `${recipe.approvedByName} - ${recipe.approvedAt.toLocaleString()}`
              : "Not approved"
          }
        />
      </Card>
      <Card className="mb-5 overflow-hidden">
        <SectionTitle
          title="Recipe ingredients"
          subtitle="Standard net quantity and allowance remain separate."
        />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[65rem] text-left text-sm">
            <thead className="bg-[var(--surface)]">
              <tr>
                <th className="p-3">Sequence</th>
                <th className="p-3">Raw material</th>
                <th className="p-3">Entered</th>
                <th className="p-3">Canonical</th>
                <th className="p-3">Allowance</th>
                <th className="p-3">Process notes</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {recipe.ingredients.map((line) => (
                <tr key={line.id}>
                  <td className="p-3">{line.sequence}</td>
                  <td className="p-3">
                    <strong>{line.itemCode}</strong> - {line.itemName}
                  </td>
                  <td className="p-3">
                    {line.enteredQuantity} {line.enteredUnitSymbol}
                  </td>
                  <td className="p-3">
                    {line.normalizedQuantity} {line.canonicalUnitSymbol}
                  </td>
                  <td className="p-3">{line.allowancePercent}%</td>
                  <td className="p-3">{line.processNotes ?? "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <Card className="mb-5 overflow-hidden">
        <SectionTitle
          title="Packaging BOM"
          subtitle={`Finished-good profile: ${recipe.piecesPerCarton} pieces per carton.`}
        />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[65rem] text-left text-sm">
            <thead className="bg-[var(--surface)]">
              <tr>
                <th className="p-3">Sequence</th>
                <th className="p-3">Packaging material</th>
                <th className="p-3">Usage basis</th>
                <th className="p-3">Quantity / basis</th>
                <th className="p-3">Canonical</th>
                <th className="p-3">Allowance</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {recipe.packagingLines.map((line) => (
                <tr key={line.id}>
                  <td className="p-3">{line.sequence}</td>
                  <td className="p-3">
                    <strong>{line.itemCode}</strong> - {line.itemName}
                  </td>
                  <td className="p-3">{line.usageBasis.replaceAll("_", " ")}</td>
                  <td className="p-3">
                    {line.enteredQuantity} {line.enteredUnitSymbol}
                  </td>
                  <td className="p-3">
                    {line.normalizedQuantity} {line.canonicalUnitSymbol}
                  </td>
                  <td className="p-3">{line.allowancePercent}%</td>
                </tr>
              ))}
              {recipe.packagingLines.length === 0 && (
                <tr>
                  <td className="p-4 text-[var(--muted)]" colSpan={6}>
                    No packaging BOM lines.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
      <Card className="mb-5 p-5">
        <RecipeCalculators
          packagingAction={calculatePackagingAction}
          recipe={recipe}
          scaleAction={scaleRecipeAction}
          units={units}
        />
      </Card>
      <Card className="mb-5 p-5">
        <h2 className="font-semibold">Version history</h2>
        <div className="mt-3 flex flex-wrap gap-2">
          {recipe.history.map((version) => (
            <Link
              className={`rounded-lg border px-3 py-2 text-xs ${version.id === recipe.id ? "bg-[var(--surface)] font-semibold" : ""}`}
              href={`/production/recipes/${version.id}`}
              key={version.id}
            >
              v{version.version} - {version.status}
            </Link>
          ))}
        </div>
      </Card>
      <Card className="mb-5 p-5">
        <h2 className="font-semibold">Notes</h2>
        <p className="mt-2 whitespace-pre-wrap text-sm">{recipe.notes ?? "-"}</p>
      </Card>
      {canManage && (
        <Card className="space-y-4 p-5">
          <h2 className="font-semibold">Lifecycle actions</h2>
          {recipe.status === "DRAFT" && (
            <ApproveRecipeForm action={approveRecipeAction} id={recipe.id} />
          )}
          {recipe.status === "APPROVED" && (
            <InactivateRecipeForm action={inactivateRecipeAction} id={recipe.id} />
          )}
        </Card>
      )}
    </ResponsiveContainer>
  );
}
function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-[var(--muted)]">{label}</dt>
      <dd className="mt-1 text-sm">{value}</dd>
    </div>
  );
}
function SectionTitle({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="border-b p-5">
      <h2 className="font-semibold">{title}</h2>
      <p className="mt-1 text-xs text-[var(--muted)]">{subtitle}</p>
    </div>
  );
}
