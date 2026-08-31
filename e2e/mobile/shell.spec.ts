import { mkdirSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { expect, test } from "@playwright/test";

import type { Phase27WorkflowState } from "../../src/test/phase27-golden-workflow";
import { login } from "../fixtures";
import { e2eStatePath } from "../state";

const evidenceDirectory = path.join(os.tmpdir(), "factory-erp-phase29-evidence");

test.beforeAll(() => mkdirSync(evidenceDirectory, { recursive: true }));

test("phone login, nested navigation, table, form, and safety action remain usable", async ({
  page,
}) => {
  const state = JSON.parse(readFileSync(e2eStatePath, "utf8")) as Phase27WorkflowState;
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  await expectNoDocumentOverflow(page);
  await expectControlInsideViewport(page, "Email");
  await expectControlInsideViewport(page, "Password");
  await page.screenshot({
    fullPage: true,
    path: path.join(evidenceDirectory, "login-360x800.png"),
  });

  await login(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Open navigation menu" }).click();
  const dialog = page.getByRole("dialog", { name: "Mobile navigation" });
  await expect(dialog).toBeVisible();
  const navigation = page.getByRole("navigation", { name: "Primary navigation" });
  await expect(navigation).toBeVisible();
  await navigation.getByRole("button", { name: "Expand Inventory navigation" }).click();
  await navigation.getByRole("link", { name: "Stock overview" }).click();
  await expect(page).toHaveURL(/\/inventory\/stock-overview$/);
  await expect(page.getByRole("heading", { name: "Stock Overview", exact: true })).toBeVisible();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Open navigation menu" })).toBeVisible();
  await expectNoDocumentOverflow(page);

  const tableRegion = page.locator("div.overflow-x-auto").filter({ has: page.locator("table") });
  await expect(tableRegion.first()).toBeVisible();
  expect(
    await tableRegion.first().evaluate((element) => element.scrollWidth > element.clientWidth),
  ).toBe(true);
  await expect(page.getByText(/cartons? \+ .*loose/i).first()).toBeVisible();
  await page.screenshot({
    fullPage: true,
    path: path.join(evidenceDirectory, "stock-overview-390x844.png"),
  });

  await page.setViewportSize({ width: 430, height: 860 });
  await page.goto(`/sales/payments/new?customer=${state.customerId}`);
  await expect(page.getByRole("heading", { name: "New Customer Payment" })).toBeVisible();
  await expectControlInsideViewport(page, "Payment date");
  await expectControlInsideViewport(page, "Amount");
  await expect(page.getByRole("button", { name: "Create draft" })).toBeVisible();
  await expectNoDocumentOverflow(page);
  await page.screenshot({
    fullPage: true,
    path: path.join(evidenceDirectory, "customer-payment-430x860.png"),
  });

  await page.setViewportSize({ width: 768, height: 900 });
  await page.goto("/accounting/manual-journals");
  await expect(page.getByRole("heading", { name: "Manual Journal" })).toBeVisible();
  await expectControlInsideViewport(page, "Journal lines JSON");
  await expect(page.getByRole("button", { name: "Post manual journal" })).toBeVisible();
  await expectNoDocumentOverflow(page);
  await page.screenshot({
    fullPage: true,
    path: path.join(evidenceDirectory, "manual-journal-768x900.png"),
  });
});

async function expectNoDocumentOverflow(page: import("@playwright/test").Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
}

async function expectControlInsideViewport(page: import("@playwright/test").Page, label: string) {
  const control = page.getByLabel(label, { exact: true });
  await expect(control).toBeVisible();
  const box = await control.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(await page.evaluate(() => window.innerWidth));
}
