import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";

import { PHASE27_QUALITY } from "../src/test/test-environment";
import { login } from "./fixtures";
import { observeRuntime } from "./runtime-observation";
import { e2eStatePath } from "./state";

test("creates Reprocess and Waste drafts through their active workbenches", async ({ page }) => {
  const observation = observeRuntime(page);
  await login(page);

  await page.goto("/production/reprocess");
  await expect(page.getByRole("heading", { name: "Reprocess", exact: true })).toBeVisible();
  await page.getByRole("link", { name: "New Reprocess" }).click();
  await expect(page.getByLabel("Finished-good lot in REPROCESS")).toHaveValue(/P27-FG/);
  await page.getByLabel("Reason", { exact: true }).fill("Controlled E2E reprocess draft");
  await page.getByRole("button", { name: "Create Reprocess draft" }).click();
  await expect(page).toHaveURL(/\/production\/reprocess\/[a-f0-9-]+$/);
  await expect(page.getByRole("list", { name: "Custody and genealogy" })).toBeVisible();
  await expect(page.getByText("Pending output", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Edit Reprocess draft" }).click();
  await page.getByLabel("Reason", { exact: true }).fill("Corrected controlled E2E reason");
  await page.getByRole("button", { name: "Save Reprocess draft" }).click();
  await expect(page.getByText("Corrected controlled E2E reason", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Reserve source lot" }).click();
  await expect(page.getByRole("button", { name: "Start Reprocess" })).toBeVisible();
  await page.getByRole("button", { name: "Start Reprocess" }).click();
  await page.getByRole("link", { name: "Open linked production batch" }).click();
  await expect(page).toHaveURL(/\/production\/batches\/[a-f0-9-]+$/);
  await expect(page.getByRole("heading", { name: /^BATCH-/ })).toBeVisible();

  await page.goto("/production/waste-damage/new");
  await expect(page.getByRole("heading", { name: "New Waste & Damage disposition" })).toBeVisible();
  await page.getByLabel("Item, lot and custody").fill("DAMAGED");
  await page
    .locator('[role="listbox"]')
    .getByRole("option", { name: /DAMAGED/ })
    .click();
  await expect(page.getByLabel("Item, lot and custody")).toHaveValue(/DAMAGED/);
  await page.getByRole("button", { name: "Add item" }).click();
  await expect(page.getByRole("group", { name: "Line 2" })).toBeVisible();
  await page.getByRole("group", { name: "Line 2" }).getByRole("button", { name: "Remove" }).click();
  await page.getByRole("button", { name: "Save disposition draft" }).click();
  await expect(page).toHaveURL(/\/production\/waste-damage\/[a-f0-9-]+$/);
  await expect(page.getByRole("list", { name: "Custody and genealogy" })).toBeVisible();
  await page.getByRole("link", { name: "Edit draft" }).click();
  await expect(page.getByRole("heading", { name: /Edit WD-/ })).toBeVisible();
  await page.getByRole("button", { name: "Save disposition draft" }).click();
  await page.getByRole("button", { name: "Post disposition" }).click();
  await expect(page.getByText("POSTED", { exact: true }).first()).toBeVisible();
  await page.getByLabel("Reversal reason").fill("Controlled E2E compensating correction");
  await page.getByRole("button", { name: "Reverse disposition" }).click();
  await expect(page.getByText("REVERSED", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("link", { name: "Edit draft" })).toHaveCount(0);
  observation.assertClean();
});

test("renders both workflow lists at desktop width without overflow", async ({
  page,
}, testInfo) => {
  const observation = observeRuntime(page);
  await page.setViewportSize({ width: 1280, height: 800 });
  await login(page);
  await page.goto("/production/reprocess");
  await expect(page.getByRole("heading", { name: "Reprocess", exact: true })).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    ),
  ).toBe(true);
  await page.getByLabel("Status").selectOption("AWAITING_QC");
  await page.getByRole("button", { name: "Apply" }).click();
  await expect(page).toHaveURL(/status=AWAITING_QC/);
  await expect(page.getByRole("row", { name: /AWAITING_QC/ })).toBeVisible();
  await page.getByRole("link", { name: "Clear" }).click();
  await page.screenshot({ path: testInfo.outputPath("reprocess-desktop.png"), fullPage: true });
  await page.goto("/production/waste-damage");
  await expect(page.getByRole("heading", { name: "Waste & Damage", exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("waste-desktop.png"), fullPage: true });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    ),
  ).toBe(true);
  await page.setViewportSize({ width: 768, height: 900 });
  await page.goto("/production/reprocess");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    ),
  ).toBe(true);
  await page.goto("/production/waste-damage");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    ),
  ).toBe(true);
  observation.assertClean();
});

test("routes an awaiting result to an independent quality decision", async ({ page }) => {
  const observation = observeRuntime(page);
  const state = JSON.parse(readFileSync(e2eStatePath, "utf8")) as {
    awaitingReprocessId: string;
  };
  await login(page);
  await page.goto(`/production/reprocess/${state.awaitingReprocessId}/qc`);
  await expect(
    page.getByText("Another authorized quality user must review this reprocess result."),
  ).toBeVisible();
  await page.getByRole("button", { name: "Log out" }).click();
  await login(page, PHASE27_QUALITY);
  await page.goto(`/production/reprocess/${state.awaitingReprocessId}/qc`);
  await expect(page.getByRole("heading", { name: /Quality review:/ })).toBeVisible();
  await page.getByRole("button", { name: "Post quality decision" }).click();
  await expect(page).toHaveURL(`/production/reprocess/${state.awaitingReprocessId}`);
  await expect(page.getByText("RELEASED", { exact: true }).first()).toBeVisible();
  observation.assertClean();
});
