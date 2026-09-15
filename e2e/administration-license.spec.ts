import { expect, test } from "@playwright/test";

import { PHASE27_VIEWER } from "../src/test/test-environment";
import { login } from "./fixtures";
import { observeRuntime } from "./runtime-observation";

test("an administrator can view license status and generate an activation request", async ({
  page,
}) => {
  const observation = observeRuntime(page);
  await login(page);

  await page.goto("/administration/license");
  await expect(page.getByRole("heading", { name: "License", exact: true })).toBeVisible();
  // Outside production (dev/test), licensing always evaluates as
  // unrestricted -- see src/server/licensing/license-service.ts.
  await expect(page.getByText("Licensed", { exact: true })).toBeVisible();
  await expect(page.getByText("Business mutations:")).toBeVisible();
  await expect(page.getByText("Allowed")).toBeVisible();

  await page.getByRole("button", { name: "Generate activation request" }).click();
  await expect(page.getByText(/Activation request written to/)).toBeVisible();

  observation.assertClean();
});

test("importing an invalid license file shows a clear error", async ({ page }) => {
  const observation = observeRuntime(page);
  await login(page);

  await page.goto("/administration/license");
  await page.getByLabel("License file").setInputFiles({
    name: "bad.lic",
    mimeType: "application/json",
    buffer: Buffer.from("not a real license file"),
  });
  await page.getByRole("button", { name: "Import license" }).click();
  await expect(
    page.getByText("The uploaded file is not valid license JSON.", { exact: true }),
  ).toBeVisible();

  observation.assertClean();
});

test("a view-only identity cannot reach the license panel", async ({ page }) => {
  const observation = observeRuntime(page);
  await login(page, PHASE27_VIEWER);
  await page.goto("/administration/license");
  await expect(page).toHaveURL(/\/access-denied$/);
  observation.assertClean();
});
