import { expect, test } from "@playwright/test";

import { login } from "./fixtures";
import { observeRuntime } from "./runtime-observation";

test("UX-16: a new accounting period opens on the month after the latest one", async ({ page }) => {
  const observation = observeRuntime(page);
  await login(page);
  await page.goto("/accounting/settings");
  const name = page.locator('input[name="name"][placeholder="Period name"]');
  await expect(name).not.toHaveValue("");
  const start = await page.locator('input[name="startDate"]').inputValue();
  const end = await page.locator('input[name="endDate"]').inputValue();
  expect(start).toMatch(/^\d{4}-\d{2}-01$/);
  expect(end > start).toBe(true);
  observation.assertClean();
});
