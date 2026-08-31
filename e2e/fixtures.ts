import { expect, type Page } from "@playwright/test";

import { PHASE27_ADMIN, PHASE27_VIEWER } from "../src/test/test-environment";

export type E2eIdentity = typeof PHASE27_ADMIN | typeof PHASE27_VIEWER;

export async function login(page: Page, identity: E2eIdentity = PHASE27_ADMIN) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(identity.email);
  await page.getByLabel("Password").fill(identity.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole("heading", { name: "Dashboard", exact: true })).toBeVisible();
}
