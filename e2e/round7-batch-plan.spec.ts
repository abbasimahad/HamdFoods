import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";

import type { Phase27WorkflowState } from "../src/test/phase27-golden-workflow";
import { login } from "./fixtures";
import { observeRuntime } from "./runtime-observation";
import { e2eStatePath } from "./state";

test("BUG-37: new batch plans the recipe's pieces and refuses a 0-piece plan", async ({ page }) => {
  const state = JSON.parse(readFileSync(e2eStatePath, "utf8")) as Phase27WorkflowState;
  const observation = observeRuntime(page);
  await login(page);
  await page.goto("/production/batches/new");
  await page.locator('select[name="recipeId"]').selectOption(state.recipeId);

  const quantity = page.locator('input[name="plannedBatchQuantity"]');
  const cartons = page.locator('input[name="plannedCartons"]');
  const loose = page.locator('input[name="plannedLoosePieces"]');
  // Fixture recipe: 1,000 g standard batch expected to give 1,000 g of 500 g pieces, 24 a carton.
  await expect(quantity).toHaveValue("1000");
  await expect(cartons).toHaveValue("0");
  await expect(loose).toHaveValue("2");

  // The plan scales with the batch size until the user types their own figures.
  await quantity.fill("2000");
  await expect(loose).toHaveValue("4");
  await loose.fill("3");
  await quantity.fill("3000");
  await expect(loose).toHaveValue("3");

  await cartons.fill("0");
  await loose.fill("0");
  await page.getByRole("button", { name: "Create DRAFT batch" }).click();
  await expect(page.getByRole("status")).toContainText(
    "Planned output must be more than 0 pieces.",
  );
  await expect(page).toHaveURL(/\/production\/batches\/new$/);
  observation.assertClean();
});
