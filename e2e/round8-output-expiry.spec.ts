import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";

import { defaultExpiryDate } from "../src/modules/production/domain/output-calculations";
import { todayInFactoryTimeZone } from "../src/server/shared/factory-local-time";
import type { Phase27WorkflowState } from "../src/test/phase27-golden-workflow";
import { login } from "./fixtures";
import { observeRuntime } from "./runtime-observation";
import { e2eStatePath } from "./state";

test("BUG-39: finished-good shelf life pre-fills good-output expiry and pieces", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const state = JSON.parse(readFileSync(e2eStatePath, "utf8")) as Phase27WorkflowState;
  const observation = observeRuntime(page);
  await login(page);

  // Give the finished good a shelf life on its item record.
  await page.goto("/inventory/finished-goods");
  const row = page
    .locator("tr")
    .filter({ has: page.locator(`a[href="/inventory/valuation/${state.finishedItemId}"]`) });
  await row.getByText("Edit", { exact: true }).click();
  const shelfLife = row.locator('input[name="shelfLifeDays"]');
  await shelfLife.fill("180");
  await row.getByRole("button", { name: "Save item" }).click();
  await expect(row.getByRole("button", { name: "Save item" })).toBeEnabled();
  await page.reload();
  await row.getByText("Edit", { exact: true }).click();
  await expect(row.locator('input[name="shelfLifeDays"]')).toHaveValue("180");

  // An in-progress batch's good-output form dates expiry from production + 180 days and offers
  // the plan still to record.
  const { inProgressBatchId } = state as Phase27WorkflowState & { inProgressBatchId: string };
  await page.goto(`/production/batches/${inProgressBatchId}/output?type=GOOD`);
  const today = todayInFactoryTimeZone();
  await expect(page.locator('input[name="productionDate"]')).toHaveValue(today);
  const expiry = page.locator('input[name="expiryDate"]');
  await expect(expiry).toHaveValue(defaultExpiryDate(today, 180));
  await expect(page.getByText("Production date + 180 days shelf life.")).toBeVisible();
  await expect(page.locator('input[name="cartons"]')).toHaveValue("0");
  await expect(page.locator('input[name="loosePieces"]')).toHaveValue("2");
  // Expiry follows the production date until the user types one.
  await page.locator('input[name="productionDate"]').fill("2026-12-01");
  await expect(expiry).toHaveValue("2027-05-30");
  observation.assertClean();
});
