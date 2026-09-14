import { expect, test } from "@playwright/test";

import { PHASE27_VIEWER } from "../src/test/test-environment";
import { login } from "./fixtures";
import { observeRuntime } from "./runtime-observation";

test("an administrator can update the company profile and it persists", async ({ page }) => {
  const observation = observeRuntime(page);
  await login(page);

  await page.goto("/administration/settings");
  await expect(page.getByRole("heading", { name: "Settings", exact: true })).toBeVisible();
  await expect(page.getByLabel("Legal / trading name")).toHaveValue(/.+/);

  await page.getByLabel("Legal / trading name").fill("Hamd Foods (Pvt) Ltd - E2E");
  await page.getByLabel("Address", { exact: true }).fill("12 Factory Road");
  await page.getByLabel("City", { exact: true }).fill("Lahore");
  await page.getByRole("button", { name: "Save company profile" }).click();
  await expect(page.getByText("Company profile saved.", { exact: true })).toBeVisible();

  await page.reload();
  await expect(page.getByLabel("Legal / trading name")).toHaveValue("Hamd Foods (Pvt) Ltd - E2E");

  // Restore the default so other tests/printed documents are unaffected.
  await page.getByLabel("Legal / trading name").fill("Hamd Foods ERP");
  await page.getByLabel("Address", { exact: true }).fill("");
  await page.getByLabel("City", { exact: true }).fill("");
  await page.getByRole("button", { name: "Save company profile" }).click();
  await expect(page.getByText("Company profile saved.", { exact: true })).toBeVisible();
  observation.assertClean();
});

test("a view-only identity cannot reach administration settings", async ({ page }) => {
  const observation = observeRuntime(page);
  await login(page, PHASE27_VIEWER);
  await page.goto("/administration/settings");
  await expect(page).toHaveURL(/\/access-denied$/);
  observation.assertClean();
});
