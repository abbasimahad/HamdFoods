import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";

import type { Phase27WorkflowState } from "../src/test/phase27-golden-workflow";
import { login } from "./fixtures";
import { e2eStatePath } from "./state";

test("admin can render every major ERP area without a fatal error", async ({ page }) => {
  await login(page);
  for (const [route, heading] of [
    ["/dashboard", "Dashboard"],
    ["/inventory", "Inventory"],
    ["/purchasing", "Purchasing"],
    ["/production", "Production"],
    ["/sales", "Sales"],
    ["/accounting", "Accounting"],
    ["/reports", "Reports"],
    ["/administration", "Administration"],
  ] as const) {
    const response = await page.goto(route);
    expect(response?.ok()).toBe(true);
    await expect(page.getByRole("heading", { name: heading, exact: true })).toBeVisible();
  }
});

test("representative printable documents and financial report render", async ({ page }) => {
  const state = JSON.parse(readFileSync(e2eStatePath, "utf8")) as Phase27WorkflowState;
  await login(page);

  await page.goto(`/purchasing/purchase-orders/${state.purchaseOrderId}/print`);
  await expect(page.getByText("Purchase Order", { exact: true })).toBeVisible();
  await expect(page.getByText("P27-RAW", { exact: false })).toBeVisible();

  await page.goto(`/sales/invoices/${state.invoiceId}/print`);
  await expect(page.getByRole("heading", { name: "Sales Invoice" })).toBeVisible();
  await expect(page.getByText("Phase 27 Customer", { exact: true })).toBeVisible();

  await page.goto("/accounting/reports/profit-loss?from=2026-01-01&to=2026-12-31");
  await expect(page.getByRole("heading", { name: "Profit & Loss" })).toBeVisible();
  await expect(page.getByText("Net profit / (loss)", { exact: true })).toBeVisible();
});

test("reconciled navigation exposes workbenches without duplicate journal vouchers", async ({
  page,
}) => {
  await login(page);
  await page.goto("/accounting");
  const nav = page.getByRole("navigation", { name: "Primary navigation" });
  await expect(nav.getByRole("link", { name: "Receivables" })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Payables" })).toBeVisible();
  await expect(nav.getByText("Journal Vouchers", { exact: true })).toHaveCount(0);
  await page.goto("/production");
  await expect(nav.getByRole("link", { name: "Material Issues" })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Packaging Consumption" })).toBeVisible();
});
