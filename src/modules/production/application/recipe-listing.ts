import { RECIPE_STATUSES, type RecipeStatus } from "./contracts";

export function parseRecipeStatus(value?: string): RecipeStatus | undefined {
  return RECIPE_STATUSES.find((status) => status === value);
}
export function parseRecipePage(value?: string) {
  const page = Number(value);
  return Number.isInteger(page) && page > 0 ? Math.min(page, 100000) : 1;
}
export function parseRecipeVersion(value?: string) {
  const version = Number(value);
  return Number.isInteger(version) && version > 0 ? version : undefined;
}
