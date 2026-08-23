"use client";

import { useActionState } from "react";
import type {
  PackagingRequirementResult,
  RecipeRecord,
  RecipeUnit,
  ScaleRecipeResult,
} from "@/modules/production/application/contracts";

export type ScaleState = { message: string; result?: ScaleRecipeResult };
export type PackagingState = { message: string; result?: PackagingRequirementResult };

export function RecipeCalculators({
  recipe,
  units,
  scaleAction,
  packagingAction,
}: {
  recipe: RecipeRecord;
  units: readonly RecipeUnit[];
  scaleAction: (state: ScaleState, data: FormData) => Promise<ScaleState>;
  packagingAction: (state: PackagingState, data: FormData) => Promise<PackagingState>;
}) {
  const [scale, submitScale, scaling] = useActionState(scaleAction, { message: "" });
  const [packaging, submitPackaging, packagingPending] = useActionState(packagingAction, {
    message: "",
  });
  const targetUnits = units.filter((unit) => unit.dimension === recipe.standardBatchDimension);
  return (
    <div className="grid gap-5 xl:grid-cols-2">
      <section className="rounded-xl border p-5">
        <h2 className="font-semibold">Recipe scaling</h2>
        <form action={submitScale} className="mt-4 flex flex-wrap items-end gap-3">
          <input name="id" type="hidden" value={recipe.id} />
          <label className="text-sm font-medium">
            Target batch
            <input
              className="mt-1 min-h-10 w-36 rounded-lg border px-3"
              min="0"
              name="targetQuantity"
              required
              step="any"
              type="number"
            />
          </label>
          <label className="text-sm font-medium">
            Unit
            <select
              className="mt-1 min-h-10 rounded-lg border bg-white px-3"
              name="targetUnitId"
              required
            >
              <option value="">Select</option>
              {targetUnits.map((unit) => (
                <option key={unit.id} value={unit.id}>
                  {unit.code}
                </option>
              ))}
            </select>
          </label>
          <button
            className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
            disabled={scaling}
          >
            Scale
          </button>
        </form>
        {scale.message && (
          <p className="mt-3 text-sm" role="status">
            {scale.message}
          </p>
        )}
        {scale.result && (
          <div className="mt-4 overflow-x-auto">
            <p className="mb-2 text-sm">
              Scale factor: <strong>{scale.result.scaleFactor}</strong>
            </p>
            <table className="w-full min-w-[38rem] text-left text-sm">
              <thead>
                <tr>
                  <th className="p-2">Ingredient</th>
                  <th className="p-2">Standard</th>
                  <th className="p-2">Scaled net</th>
                  <th className="p-2">Planned issue</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {scale.result.ingredients.map((line) => (
                  <tr key={line.itemCode}>
                    <td className="p-2">
                      {line.itemCode} - {line.itemName}
                    </td>
                    <td className="p-2">
                      {line.standardNormalizedQuantity} {line.canonicalUnitSymbol}
                    </td>
                    <td className="p-2">
                      {line.scaledNormalizedQuantity} {line.canonicalUnitSymbol}
                    </td>
                    <td className="p-2">
                      {line.plannedIssueNormalizedQuantity} {line.canonicalUnitSymbol}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <section className="rounded-xl border p-5">
        <h2 className="font-semibold">Packaging requirements</h2>
        <form action={submitPackaging} className="mt-4 flex flex-wrap items-end gap-3">
          <input name="id" type="hidden" value={recipe.id} />
          <label className="text-sm font-medium">
            Cartons
            <input
              className="mt-1 min-h-10 w-28 rounded-lg border px-3"
              defaultValue="0"
              min="0"
              name="cartons"
              required
              step="1"
              type="number"
            />
          </label>
          <label className="text-sm font-medium">
            Loose pieces
            <input
              className="mt-1 min-h-10 w-28 rounded-lg border px-3"
              defaultValue="0"
              min="0"
              name="loosePieces"
              required
              step="1"
              type="number"
            />
          </label>
          <button
            className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
            disabled={packagingPending}
          >
            Calculate
          </button>
        </form>
        {packaging.message && (
          <p className="mt-3 text-sm" role="status">
            {packaging.message}
          </p>
        )}
        {packaging.result && (
          <div className="mt-4 overflow-x-auto">
            <p className="mb-2 text-sm">
              {packaging.result.cartons} cartons + {packaging.result.loosePieces} loose ={" "}
              {packaging.result.totalPieces} pieces
            </p>
            <table className="w-full min-w-[40rem] text-left text-sm">
              <thead>
                <tr>
                  <th className="p-2">Material</th>
                  <th className="p-2">Basis</th>
                  <th className="p-2">Standard</th>
                  <th className="p-2">Recommended</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {packaging.result.lines.map((line) => (
                  <tr key={`${line.itemCode}:${line.usageBasis}`}>
                    <td className="p-2">
                      {line.itemCode} - {line.itemName}
                    </td>
                    <td className="p-2">{line.usageBasis.replaceAll("_", " ")}</td>
                    <td className="p-2">
                      {line.standardRequiredQuantity} {line.canonicalUnitSymbol}
                    </td>
                    <td className="p-2">
                      {line.recommendedIssueQuantity} {line.canonicalUnitSymbol}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
