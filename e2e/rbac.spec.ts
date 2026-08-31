import { expect, test } from "@playwright/test";

import { PHASE27_VIEWER } from "../src/test/test-environment";
import { login } from "./fixtures";

test("view-only identity is denied protected management routes and actions", async ({ page }) => {
  await login(page, PHASE27_VIEWER);

  await page.goto("/administration/users");
  await expect(page.getByRole("heading", { name: "Access denied" })).toBeVisible();

  await page.goto("/accounting/settings");
  await expect(page.getByRole("heading", { name: "Access denied" })).toBeVisible();

  await page.goto("/inventory/stock-adjustments");
  await expect(page.getByText(/inventory\.manage is required to post changes/i)).toBeVisible();
  await expect(page.getByRole("heading", { name: "Opening stock" })).toHaveCount(0);

  await expect(page.getByRole("link", { name: "Administration", exact: true })).toHaveCount(0);
});
