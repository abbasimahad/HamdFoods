import { z } from "zod";
import type { ApplicationPrincipal } from "@/modules/access/domain/principal";
import { normalizeMasterCode } from "@/modules/master-data/domain/master-data";
import {
  PACKAGING_USAGE_BASES,
  requireProductionManager,
  type RecipeInput,
  type RecipeMutationResult,
  type RecipeRepository,
} from "./contracts";

const decimal = z.string().trim().min(1).max(80);
const optional = (max: number) => z.string().trim().max(max).optional();
const allowance = z
  .string()
  .trim()
  .regex(/^\d{1,3}(?:\.\d{1,4})?$/)
  .default("0");
const ingredientSchema = z.object({
  itemId: z.string().uuid(),
  quantity: decimal,
  unitId: z.string().uuid(),
  allowancePercent: allowance,
  processNotes: optional(1000),
});
const packagingSchema = z.object({
  itemId: z.string().uuid(),
  usageBasis: z.enum(PACKAGING_USAGE_BASES),
  quantity: decimal,
  unitId: z.string().uuid(),
  allowancePercent: allowance,
  notes: optional(1000),
});
const recipeSchema = z.object({
  id: z.string().uuid().optional(),
  code: z.string().trim().min(2).max(60),
  name: z.string().trim().min(2).max(160),
  finishedGoodId: z.string().uuid(),
  standardBatchQuantity: decimal,
  standardBatchUnitId: z.string().uuid(),
  expectedOutputQuantity: decimal.optional(),
  expectedOutputUnitId: z.string().uuid().optional(),
  effectiveDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  notes: optional(3000),
  ingredients: z.array(ingredientSchema).min(1).max(200),
  packagingLines: z.array(packagingSchema).max(200),
});

export async function saveRecipe(
  actor: ApplicationPrincipal,
  form: Record<string, unknown>,
  repository: RecipeRepository,
): Promise<RecipeMutationResult> {
  const denied = requireProductionManager(actor);
  if (denied) return denied;
  const ingredients = decode(form.ingredientsJson);
  const packagingLines = decode(form.packagingLinesJson);
  if (!ingredients.ok || !packagingLines.ok)
    return { ok: false, message: "Recipe lines are invalid." };
  const parsed = recipeSchema.safeParse({
    ...form,
    id: text(form.id),
    code: normalizeMasterCode(String(form.code ?? "")),
    expectedOutputQuantity: text(form.expectedOutputQuantity),
    expectedOutputUnitId: text(form.expectedOutputUnitId),
    effectiveDate: text(form.effectiveDate),
    notes: text(form.notes),
    ingredients: ingredients.value,
    packagingLines: packagingLines.value,
  });
  if (!parsed.success)
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid recipe." };
  if (Boolean(parsed.data.expectedOutputQuantity) !== Boolean(parsed.data.expectedOutputUnitId))
    return { ok: false, message: "Expected output quantity and unit must be supplied together." };
  const input: RecipeInput = { ...parsed.data, actorUserId: actor.id };
  try {
    const id = input.id
      ? await repository.updateRecipe({ ...input, id: input.id })
      : await repository.createRecipe(input);
    return { ok: true, id };
  } catch (error) {
    return failure(error, "Recipe could not be saved.");
  }
}
export async function approveRecipe(
  actor: ApplicationPrincipal,
  id: string,
  repository: RecipeRepository,
): Promise<RecipeMutationResult> {
  return lifecycle(actor, id, repository, (actorId) => repository.approveRecipe(id, actorId));
}
export async function inactivateRecipe(
  actor: ApplicationPrincipal,
  id: string,
  repository: RecipeRepository,
): Promise<RecipeMutationResult> {
  return lifecycle(actor, id, repository, () => repository.inactivateRecipe(id));
}
export async function createNewRecipeVersion(
  actor: ApplicationPrincipal,
  id: string,
  repository: RecipeRepository,
): Promise<RecipeMutationResult> {
  const denied = requireProductionManager(actor);
  if (denied) return denied;
  if (!z.string().uuid().safeParse(id).success) return { ok: false, message: "Invalid recipe." };
  try {
    return { ok: true, id: await repository.createNewVersion(id, actor.id) };
  } catch (error) {
    return failure(error, "Recipe version could not be created.");
  }
}
async function lifecycle(
  actor: ApplicationPrincipal,
  id: string,
  repository: RecipeRepository,
  operation: (actorId: string) => Promise<void>,
): Promise<RecipeMutationResult> {
  const denied = requireProductionManager(actor);
  if (denied) return denied;
  if (!z.string().uuid().safeParse(id).success) return { ok: false, message: "Invalid recipe." };
  try {
    await operation(actor.id);
    return { ok: true, id };
  } catch (error) {
    return failure(error, "Recipe operation failed.");
  }
}
function decode(value: unknown): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(String(value ?? "[]")) };
  } catch {
    return { ok: false };
  }
}
function text(value: unknown) {
  const result = String(value ?? "").trim();
  return result || undefined;
}
function failure(error: unknown, fallback: string): { ok: false; message: string } {
  return { ok: false, message: error instanceof Error ? error.message : fallback };
}
