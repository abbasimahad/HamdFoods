import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";

import { appNavigation } from "../src/config/navigation";
import type { Phase27WorkflowState } from "../src/test/phase27-golden-workflow";
import { login } from "./fixtures";
import { observeRuntime } from "./runtime-observation";
import { e2eStatePath } from "./state";

// A warm (already compiled) authenticated page must answer well inside this budget even on the
// development server; production builds are several times faster.
const WARM_ROUTE_BUDGET_MS = 8_000;
// Amounts on screen are grouped 2-decimal money; a run of 3+ decimals is a raw exact value leak.
const RAW_DECIMAL = /\b\d{4,}\.\d{3,}\b|\b\d+\.\d{7,}\b/;

test("every sidebar workflow renders cleanly and responds within budget", async ({ page }) => {
  test.setTimeout(600_000);
  const observation = observeRuntime(page);
  await login(page);
  const routes = [
    ...new Set(
      appNavigation.flatMap((item) => [
        item.href,
        ...(item.children ?? [])
          .filter((child) => child.status === "active")
          .map((child) => child.href),
      ]),
    ),
  ];
  expect(routes.length).toBeGreaterThan(50);
  const slow: string[] = [];
  for (const route of routes) {
    const cold = await page.goto(route);
    expect(cold?.ok(), route).toBe(true);
    await expect(page.locator("h1").first(), route).toBeVisible();
    const started = Date.now();
    const warm = await page.goto(route);
    expect(warm?.ok(), route).toBe(true);
    await expect(page.locator("h1").first(), route).toBeVisible();
    const elapsed = Date.now() - started;
    if (elapsed > WARM_ROUTE_BUDGET_MS) slow.push(`${route} ${elapsed}ms`);
  }
  expect(slow, "routes over the warm response budget").toEqual([]);
  observation.assertClean();
});

test("round-6 screens show reversals, GRNI and formatted amounts", async ({ page }) => {
  test.setTimeout(180_000);
  const state = JSON.parse(readFileSync(e2eStatePath, "utf8")) as Phase27WorkflowState;
  const observation = observeRuntime(page);
  await login(page);

  // BUG-35: GRNI is a reconciled control account.
  await page.goto("/accounting/reconciliation");
  await expect(
    page.getByRole("cell", { name: "Goods Received Not Invoiced (GRNI)" }),
  ).toBeVisible();

  // UX-15 and the retained-earnings fix: the balance sheet balances.
  await page.goto("/accounting/reports/balance-sheet");
  await expect(
    page
      .getByRole("row", { name: /Balance-sheet difference/ })
      .getByRole("cell")
      .last(),
  ).toHaveText("0.00");

  // UX-9 / UX-14: lists and ledgers show grouped 2-decimal money, never raw exact values.
  for (const route of [
    "/accounting/journals",
    "/accounting/general-ledger",
    "/accounting/reports/production-costing",
    "/purchasing/supplier-payments",
    `/purchasing/supplier-payments/${state.supplierPaymentId}`,
    `/purchasing/purchase-orders/${state.purchaseOrderId}`,
    `/sales/orders/${state.salesOrderId}`,
    `/sales/payments/${state.customerPaymentId}/print`,
  ]) {
    await page.goto(route);
    await expect(page.locator("h1").first(), route).toBeVisible();
    // Print pages render their own <main> inside the app shell; read the innermost one.
    const text = await page.locator("main").last().innerText();
    expect(text.match(RAW_DECIMAL)?.[0] ?? null, route).toBeNull();
  }

  // UX-14: new material transactions are stamped when saved, not when the page opened.
  await page.goto(`/production/batches/${state.batchId}/materials`);
  await expect(page.locator("h1").first()).toBeVisible();
  const time = page.locator('input[name="transactionDate"]');
  if ((await time.count()) > 0) {
    await expect(time.first()).toHaveValue("");
    await expect(page.getByText("Leave blank to record the time you save.").first()).toBeVisible();
  }

  observation.assertClean();
});
