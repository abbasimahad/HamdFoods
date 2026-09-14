import { expect, test } from "@playwright/test";

import { PHASE27_VIEWER } from "../src/test/test-environment";
import { login } from "./fixtures";
import { observeRuntime } from "./runtime-observation";

test("creates, edits, and cancels a purchase invoice draft through the active workbench", async ({
  page,
}) => {
  const observation = observeRuntime(page);
  await login(page);

  await page.goto("/purchasing/purchase-invoices");
  await expect(page.getByRole("heading", { name: "Purchase Invoices", exact: true })).toBeVisible();
  await page.getByRole("link", { name: "New Purchase Invoice" }).click();
  await expect(page.getByRole("heading", { name: "New Purchase Invoice" })).toBeVisible();

  await page.locator('select[name="supplierId"]').selectOption({ index: 1 });
  await page.getByLabel("Supplier invoice number").fill("E2E-INV-001");
  await page.getByLabel("Invoice date").fill("2026-07-10");

  await page.getByLabel("Purchase order line").selectOption({ index: 1 });
  await page.getByLabel("Invoiced quantity").fill("1");
  await page.getByLabel("Invoiced rate").fill("1");

  await page.getByRole("button", { name: "Create draft invoice" }).click();
  await expect(page).toHaveURL(/\/purchasing\/purchase-invoices\/[a-f0-9-]+$/);
  await expect(page.getByText("DRAFT purchase invoice", { exact: true })).toBeVisible();
  await expect(page.getByText("E2E-INV-001", { exact: true })).toBeVisible();

  await page.getByRole("link", { name: "Edit draft" }).click();
  await expect(page.getByRole("heading", { name: /Edit PI-/ })).toBeVisible();
  await page.getByLabel("Notes", { exact: true }).fill("Controlled E2E draft edit.");
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page.getByText("Controlled E2E draft edit.", { exact: true })).toBeVisible();

  await page.getByLabel("Cancellation reason").fill("Controlled E2E cleanup.");
  await page.getByRole("button", { name: "Cancel draft" }).click();
  await expect(page.getByText("CANCELLED purchase invoice", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Edit draft" })).toHaveCount(0);
  observation.assertClean();
});

test("a view-only identity cannot reach purchase invoice creation", async ({ page }) => {
  const observation = observeRuntime(page);
  await login(page, PHASE27_VIEWER);
  await page.goto("/purchasing/purchase-invoices");
  await expect(page.getByRole("heading", { name: "Purchase Invoices", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "New Purchase Invoice" })).toHaveCount(0);
  await page.goto("/purchasing/purchase-invoices/new");
  await expect(page).toHaveURL(/\/access-denied$/);
  observation.assertClean();
});
