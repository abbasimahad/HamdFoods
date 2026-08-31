import { expect, test } from "@playwright/test";

import { login } from "../fixtures";

test("mobile shell opens navigation and reaches main inventory content", async ({ page }) => {
  await login(page);
  await page.getByRole("button", { name: "Open navigation menu" }).click();
  const navigation = page.getByRole("navigation", { name: "Primary navigation" });
  await expect(navigation).toBeVisible();
  await navigation.getByRole("link", { name: "Inventory", exact: true }).click();
  await expect(page).toHaveURL(/\/inventory$/);
  await expect(page.getByRole("heading", { name: "Inventory", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Open navigation menu" })).toBeVisible();
});
