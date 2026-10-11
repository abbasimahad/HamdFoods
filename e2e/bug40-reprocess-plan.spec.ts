import { expect, test } from "@playwright/test";

import { login } from "./fixtures";
import { observeRuntime } from "./runtime-observation";

// Named to run before partial-workflows.spec.ts, which reprocesses the remaining seeded custody.
test("BUG-40: a reprocess plans the bottles being reprocessed, not a full batch", async ({
  page,
}) => {
  const observation = observeRuntime(page);
  await login(page);
  await page.goto("/production/reprocess/new");
  const quantity = page.locator('input[name="sourceQuantity"]');
  const batch = page.locator('input[name="plannedBatchQuantity"]');
  const cartons = page.locator('input[name="plannedCartons"]');
  const loose = page.locator('input[name="plannedLoosePieces"]');
  // Fixture recipe: a 1,000 g standard batch gives 2 bottles (500 g each), 24 a carton.
  const pieces = Number(await quantity.inputValue());
  expect(pieces).toBeGreaterThan(0);
  await expect(batch).toHaveValue(String(500 * pieces));
  await expect(cartons).toHaveValue(String(Math.floor(pieces / 24)));
  await expect(loose).toHaveValue(String(pieces % 24));
  await quantity.fill("1");
  await expect(batch).toHaveValue("500");
  await expect(cartons).toHaveValue("0");
  await expect(loose).toHaveValue("1");
  observation.assertClean();
});
