import { expect, test } from "@playwright/test";

import { PHASE27_ADMIN } from "../src/test/test-environment";
import { login } from "./fixtures";

test("valid Better Auth login reaches the protected ERP shell", async ({ page }) => {
  await login(page);
  await expect(page.getByText(PHASE27_ADMIN.email, { exact: true })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Primary navigation" })).toBeVisible();
});

test("invalid credentials do not establish a session", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill(PHASE27_ADMIN.email);
  await page.getByLabel("Password").fill("not-the-test-password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "Invalid email or password." }),
  ).toHaveText("Invalid email or password.");
  await expect(page).toHaveURL(/\/login$/);
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login$/);
});

test("forgot-password guidance points to local Administrator recovery only", async ({ page }) => {
  await page.goto("/login");
  await page.getByRole("link", { name: "Forgot password?" }).click();
  await expect(page).toHaveURL(/\/forgot-password$/);
  await expect(page.getByRole("heading", { name: "Account recovery" })).toBeVisible();
  await expect(page.getByText(/factory server PC/i)).toBeVisible();
  await expect(page.getByText(/no master password/i)).toBeVisible();
  await expect(page.locator('input[type="password"]')).toHaveCount(0);
});

test("authenticated users can open account security controls", async ({ page }) => {
  await login(page);
  await page.goto("/account/security");
  await expect(page.getByRole("heading", { name: "Account Security" })).toBeVisible();
  await expect(page.getByLabel("Display Name")).toBeVisible();
  await expect(page.getByLabel("New Login Email")).toBeVisible();
  await expect(page.getByLabel("New Password", { exact: true })).toBeVisible();
});

test("client-controlled values cannot activate authentication bypass", async ({
  context,
  page,
}) => {
  // Defect caught: a request header, cookie, query, or form-like URL value could otherwise impersonate SUPER_ADMIN.
  await context.setExtraHTTPHeaders({
    "x-auth-bypass-enabled": "true",
    "x-user-role": "SUPER_ADMIN",
  });
  await context.addCookies([
    {
      name: "AUTH_BYPASS_ENABLED",
      value: "true",
      domain: "127.0.0.1",
      path: "/",
    },
  ]);
  await page.goto("/dashboard?AUTH_BYPASS_ENABLED=true&role=SUPER_ADMIN");
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
});

test("logout removes access to protected ERP routes", async ({ page }) => {
  await login(page);
  await page.getByRole("button", { name: "Log out" }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login$/);
});
