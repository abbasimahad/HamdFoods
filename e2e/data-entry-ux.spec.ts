import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";

import { login } from "./fixtures";
import { PHASE27_VIEWER } from "../src/test/test-environment";
import { observeRuntime } from "./runtime-observation";
import { e2eStatePath } from "./state";

type WorkflowState = { customerId: string; supplierId: string };

test("inventory posting exposes searchable choices and a safe cancel reset", async ({ page }) => {
  const observation = observeRuntime(page);
  await login(page);
  await page.goto("/inventory/stock-adjustments");

  const adjustment = page.getByRole("region", { name: "Adjustment in" });
  await expect(adjustment.getByRole("combobox", { name: "Item" })).toBeVisible();
  await expect(adjustment.getByRole("combobox", { name: "Warehouse" })).toBeVisible();

  const item = adjustment.getByRole("combobox", { name: "Item" });
  await item.click();
  await expect(adjustment.getByRole("option").first()).toBeVisible();
  await item.fill("no-such-inventory-item");
  await expect(adjustment.getByText("No matching options")).toBeVisible();
  await item.press("Escape");
  await expect(item).toBeFocused();

  await item.fill("P27-RAW");
  await item.press("ArrowDown");
  await item.press("Enter");
  await expect(item).toHaveValue(/P27-RAW/);

  await adjustment.getByLabel("Quantity", { exact: true }).fill("25");
  await adjustment.getByLabel("Reason").fill("Cycle count correction");
  await adjustment.getByRole("button", { name: "Cancel" }).click();

  await expect(adjustment.getByLabel("Quantity", { exact: true })).toHaveValue("");
  await expect(adjustment.getByLabel("Reason")).toHaveValue("");
  observation.assertClean();
});

test("inventory posting exposes pending state and dispatches a rapid double submit once", async ({
  page,
}) => {
  const observation = observeRuntime(page);
  await login(page);

  await page.goto("/inventory/stock-movements?q=P27-RAW");
  const movementCountBefore = await page.locator("tbody tr").count();
  await page.goto("/inventory/stock-adjustments");
  const adjustment = page.getByRole("region", { name: "Adjustment in" });

  const choose = async (label: string, query: string) => {
    const combobox = adjustment.getByRole("combobox", { name: label });
    await combobox.fill(query);
    await adjustment.getByRole("option", { name: new RegExp(query) }).click();
  };
  await choose("Item", "P27-RAW");
  await choose("Warehouse", "P27-SOURCE");
  await adjustment.getByRole("combobox", { name: "Status", exact: true }).selectOption("AVAILABLE");
  await adjustment.getByRole("textbox", { name: "Quantity", exact: true }).fill("1");
  await adjustment
    .getByRole("combobox", { name: "Quantity unit", exact: true })
    .selectOption({ label: "g · MASS" });
  await adjustment.getByLabel("Unit cost (canonical unit)", { exact: true }).fill("1");
  await adjustment
    .getByLabel("Source key (optional)", { exact: true })
    .fill(`E2E-SINGLE-FLIGHT-${Date.now()}`);
  await adjustment.getByLabel("Reason").fill("Single-flight browser contract");

  await page.route("**/inventory/stock-adjustments", async (route) => {
    if (route.request().method() === "POST") {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    await route.continue();
  });

  const submit = adjustment.getByRole("button", { name: "Post movement", exact: true });
  await submit.evaluate((button: HTMLButtonElement) => {
    button.click();
    button.click();
  });
  await expect(adjustment.getByRole("button", { name: "Posting…", exact: true })).toBeDisabled();
  await expect(adjustment.getByRole("status")).toContainText("Inventory movement posted.");

  await page.goto("/inventory/stock-movements?q=P27-RAW");
  await expect(page.locator("tbody tr")).toHaveCount(movementCountBefore + 1);
  observation.assertClean();
});

test("supplier quick-create preserves the purchase order and does not submit its draft", async ({
  page,
}) => {
  const observation = observeRuntime(page);
  const unique = Date.now();
  const supplierCode = `E2E-QS-${unique}`;
  await login(page);
  await page.goto("/purchasing/purchase-orders/new");

  await page.getByLabel("Supplier quotation / reference").fill("PARENT-DATA-IS-PRESERVED");
  await page.getByRole("button", { name: "[+] Supplier", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "New Supplier" });
  await dialog.getByRole("button", { name: "Save Supplier", exact: true }).click();
  await expect(dialog.locator("input:invalid, select:invalid").first()).toBeVisible();

  await dialog.getByLabel("Supplier code").fill(supplierCode);
  await dialog.getByLabel("Supplier name").fill("E2E Quick Supplier");
  await dialog.getByLabel("Contact person").fill("Test Buyer");
  await dialog.getByLabel("Phone", { exact: true }).fill("03001234567");
  await dialog.getByLabel("Email").fill(`quick-${unique}@example.test`);
  await dialog.getByLabel("Address").fill("1 Test Industrial Estate");
  await dialog.getByLabel("City").fill("Lahore");

  const save = dialog.getByRole("button", { name: "Save Supplier", exact: true });
  await save.evaluate((button: HTMLButtonElement) => {
    button.click();
    button.click();
  });
  await expect(page.getByRole("dialog", { name: "New Supplier" })).not.toBeVisible();
  await expect(page.locator("#purchase-order-supplier")).toHaveValue(/.+/);
  await expect(page.locator("#purchase-order-supplier option:checked")).toContainText(supplierCode);
  await expect(page.getByLabel("Supplier quotation / reference")).toHaveValue(
    "PARENT-DATA-IS-PRESERVED",
  );

  await page.getByRole("link", { name: "Cancel", exact: true }).click();
  await expect(page).toHaveURL(/\/purchasing\/purchase-orders$/);
  observation.assertClean();
});

test("material quick-create returns to the recipe line with parent data intact", async ({
  page,
}) => {
  const observation = observeRuntime(page);
  const unique = Date.now();
  const materialCode = `E2E-QM-${unique}`;
  await login(page);
  await page.goto("/production/recipes/new");

  await page.getByLabel("Recipe code").fill("PARENT-RECIPE-CODE");
  const ingredients = page.getByRole("region", { name: "Recipe ingredients" });
  await ingredients.getByRole("button", { name: "[+] Material", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "New Material" });
  await dialog.getByLabel("Code", { exact: true }).fill(materialCode);
  await dialog.getByLabel("Name", { exact: true }).fill("E2E Quick Material");
  await dialog.getByLabel("Category").selectOption({ index: 1 });
  await dialog.getByLabel("Stock unit").selectOption({ index: 1 });
  await dialog.getByRole("button", { name: "Save Material", exact: true }).click();

  await expect(page.getByRole("dialog", { name: "New Material" })).not.toBeVisible();
  await expect(ingredients.locator("select").first().locator("option:checked")).toContainText(
    materialCode,
  );
  await expect(page.getByLabel("Recipe code")).toHaveValue("PARENT-RECIPE-CODE");
  await page.getByRole("link", { name: "Cancel", exact: true }).click();
  await expect(page).toHaveURL(/\/production\/recipes$/);
  observation.assertClean();
});

test("receivables workbench is read-only and launches the authoritative customer payment", async ({
  page,
}) => {
  const observation = observeRuntime(page);
  const state = JSON.parse(readFileSync(e2eStatePath, "utf8")) as WorkflowState;
  await login(page);
  await page.goto("/accounting/receivables");
  await expect(page.getByRole("heading", { name: "Receivables" })).toBeVisible();
  await page.getByRole("link", { name: /P27-CUST/ }).click();
  await expect(page).toHaveURL(new RegExp(`/accounting/receivables/${state.customerId}`));
  await expect(page.getByRole("link", { name: "+ New Customer Payment" })).toHaveAttribute(
    "href",
    new RegExp(`/sales/payments/new\\?customer=${state.customerId}`),
  );
  await expect(page.getByText("Create Receivable", { exact: true })).toHaveCount(0);
  await expect(page.locator('input[name*="balance" i]')).toHaveCount(0);
  await page.getByRole("link", { name: "+ New Customer Payment" }).click();
  await expect(page.locator("#customer-payment-customer")).toHaveValue(state.customerId);
  await page.getByRole("link", { name: "Cancel", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/accounting/receivables/${state.customerId}`));
  await page.waitForLoadState("networkidle");
  observation.assertClean();
});

test("payables workbench is read-only and launches the authoritative supplier payment", async ({
  page,
}) => {
  const observation = observeRuntime(page);
  const state = JSON.parse(readFileSync(e2eStatePath, "utf8")) as WorkflowState;
  await login(page);
  await page.goto("/accounting/payables");
  await expect(page.getByRole("heading", { name: "Payables" })).toBeVisible();
  await page.getByRole("link", { name: /P27-SUP/ }).click();
  await expect(page).toHaveURL(new RegExp(`/accounting/payables/${state.supplierId}`));
  await expect(page.getByRole("link", { name: "+ New Supplier Payment" })).toHaveAttribute(
    "href",
    new RegExp(`/purchasing/supplier-payments/new\\?supplier=${state.supplierId}`),
  );
  await expect(page.getByText("Create Payable", { exact: true })).toHaveCount(0);
  await expect(page.locator('input[name*="balance" i]')).toHaveCount(0);
  await page.getByRole("link", { name: "+ New Supplier Payment" }).click();
  await expect(page.locator('select[name="supplierId"]')).toHaveValue(state.supplierId);
  const returnResponse = page.waitForResponse(
    (response) =>
      response.request().resourceType() === "fetch" &&
      new URL(response.url()).pathname === `/accounting/payables/${state.supplierId}`,
  );
  await page.getByRole("link", { name: "Cancel", exact: true }).click();
  await (await returnResponse).finished();
  await expect(page).toHaveURL(new RegExp(`/accounting/payables/${state.supplierId}`));
  observation.assertClean();
});

test("view-only accounting user cannot launch payment creation", async ({ page }) => {
  const state = JSON.parse(readFileSync(e2eStatePath, "utf8")) as WorkflowState;
  await login(page, PHASE27_VIEWER);
  await page.goto(`/accounting/receivables/${state.customerId}`);
  await expect(page.locator("h1")).toBeVisible();
  await expect(page.getByRole("link", { name: "+ New Customer Payment" })).toHaveCount(0);
  await page.goto(`/accounting/payables/${state.supplierId}`);
  await expect(page.locator("h1")).toBeVisible();
  await expect(page.getByRole("link", { name: "+ New Supplier Payment" })).toHaveCount(0);
  await page.waitForLoadState("networkidle");
});

test("production workbenches provide direct create and immutable detail access", async ({
  page,
}) => {
  const observation = observeRuntime(page);
  await login(page);
  await page.goto("/production/material-issues");
  await expect(page.getByRole("heading", { name: "Material Issues" })).toBeVisible();
  await expect(page.getByRole("link", { name: "+ New Material Issue" })).toBeVisible();
  const material = page.locator("tbody a").first();
  await expect(material).toBeVisible();
  await material.click();
  await expect(
    page.getByText("Immutable material transaction provenance", { exact: false }),
  ).toBeVisible();
  await page.goto("/production/packaging-consumption");
  await expect(page.getByRole("heading", { name: "Packaging Consumption" })).toBeVisible();
  await expect(page.getByRole("link", { name: "+ New Packaging Transaction" })).toBeVisible();
  const packaging = page.locator("tbody a").first();
  await expect(packaging).toBeVisible();
  await packaging.click();
  await expect(
    page.getByText("Immutable packaging transaction provenance", { exact: false }),
  ).toBeVisible();
  await page.waitForLoadState("networkidle");
  observation.assertClean();
});
