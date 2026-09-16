import { expect, test } from "@playwright/test";

import { PHASE27_VIEWER } from "../src/test/test-environment";
import { login } from "./fixtures";
import { observeRuntime } from "./runtime-observation";

test("an administrator can view the updates panel and its current version", async ({ page }) => {
  const observation = observeRuntime(page);
  await login(page);

  await page.goto("/administration/updates");
  await expect(page.getByRole("heading", { name: "Updates", exact: true })).toBeVisible();
  await expect(page.getByText(/Currently installed version:/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Verify package" })).toBeVisible();

  observation.assertClean();
});

test("uploading an invalid update package shows a clear error", async ({ page }) => {
  const observation = observeRuntime(page);
  await login(page);

  await page.goto("/administration/updates");
  await page.getByLabel("Update package").setInputFiles({
    name: "bad.hfupdate",
    mimeType: "application/zip",
    buffer: Buffer.from("not a real update package"),
  });
  await page.getByRole("button", { name: "Verify package" }).click();
  await expect(page.getByText(/verification|invalid|manifest/i)).toBeVisible();

  observation.assertClean();
});

test("a view-only identity cannot reach the updates panel", async ({ page }) => {
  const observation = observeRuntime(page);
  await login(page, PHASE27_VIEWER);
  await page.goto("/administration/updates");
  await expect(page).toHaveURL(/\/access-denied$/);
  observation.assertClean();
});
