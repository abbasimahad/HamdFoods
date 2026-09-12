import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";

import type { Phase27WorkflowState } from "../src/test/phase27-golden-workflow";
import { login } from "./fixtures";
import { observeRuntime } from "./runtime-observation";
import { e2eStatePath } from "./state";

test("major and seeded ERP routes have clean browser runtime signals", async ({ page }) => {
  test.setTimeout(90_000);
  const state = JSON.parse(readFileSync(e2eStatePath, "utf8")) as Phase27WorkflowState;
  const observation = observeRuntime(page);
  await login(page);

  const routes = [
    "/dashboard",
    "/inventory",
    "/purchasing",
    "/production",
    "/sales",
    "/accounting",
    "/accounting/receivables",
    `/accounting/receivables/${state.customerId}`,
    "/accounting/payables",
    `/accounting/payables/${state.supplierId}`,
    "/reports",
    "/administration",
    "/account/security",
    `/purchasing/purchase-orders/${state.purchaseOrderId}`,
    `/purchasing/goods-receiving/${state.goodsReceiptId}`,
    `/production/batches/${state.batchId}`,
    `/production/batches/${state.batchId}/materials`,
    `/production/batches/${state.batchId}/packaging`,
    `/production/batches/${state.batchId}/output`,
    `/production/batches/${state.batchId}/costing`,
    "/production/material-issues",
    "/production/material-issues/new",
    "/production/packaging-consumption",
    "/production/packaging-consumption/new",
    `/sales/orders/${state.salesOrderId}`,
    `/sales/dispatches/${state.dispatchId}`,
    `/sales/invoices/${state.invoiceId}`,
    `/sales/payments/${state.customerPaymentId}`,
    `/sales/returns/${state.salesReturnId}`,
    `/purchasing/supplier-payments/${state.supplierPaymentId}`,
    `/sales/customers/${state.customerId}/statement`,
    `/purchasing/suppliers/${state.supplierId}/statement`,
  ];

  for (const route of routes) {
    const response = await page.goto(route);
    expect(response?.ok(), route).toBe(true);
    await expect(page.locator("h1").first(), route).toBeVisible();
  }

  observation.assertClean();
});

test("invalid active forms remain on-page with visible validation and clean runtime", async ({
  page,
}) => {
  const observation = observeRuntime(page);
  await login(page);

  for (const [route, submitName] of [
    ["/inventory/units", "Create unit"],
    ["/purchasing/purchase-orders/new", "Create draft"],
    ["/account/security", "Change password"],
  ] as const) {
    await page.goto(route);
    const expectedUrl = page.url();
    await page.getByRole("button", { name: submitName, exact: true }).click();
    await expect(page.locator("input:invalid, select:invalid").first()).toBeVisible();
    await expect(page).toHaveURL(expectedUrl);
  }

  observation.assertClean();
});
