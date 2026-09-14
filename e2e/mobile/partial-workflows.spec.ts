import { expect, test } from "@playwright/test";

import { login } from "../fixtures";
import { observeRuntime } from "../runtime-observation";

test("workflow workbenches preserve hierarchy and containment on mobile", async ({
  page,
}, testInfo) => {
  const observation = observeRuntime(page);
  await page.setViewportSize({ width: 375, height: 812 });
  await login(page);
  await page.goto("/production/reprocess");
  await expect(page.getByRole("heading", { name: "Reprocess", exact: true })).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("reprocess-mobile.png"), fullPage: true });
  await page.getByRole("link", { name: /^RP-/ }).first().click();
  await expect(page.getByRole("list", { name: "Custody and genealogy" })).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    ),
  ).toBe(true);
  await page.goto("/production/waste-damage");
  await expect(page.getByRole("heading", { name: "Waste & Damage", exact: true })).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("waste-mobile.png"), fullPage: true });
  await page.getByRole("link", { name: /^WD-/ }).first().click();
  await expect(page.getByRole("list", { name: "Custody and genealogy" })).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    ),
  ).toBe(true);
  observation.assertClean();
});
