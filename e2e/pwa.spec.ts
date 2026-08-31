import { mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { expect, test } from "@playwright/test";

import { login } from "./fixtures";

const evidenceDirectory = path.join(os.tmpdir(), "factory-erp-phase29-evidence");

test.beforeAll(() => mkdirSync(evidenceDirectory, { recursive: true }));

test("manifest exposes install metadata and repository icons", async ({ page, request }) => {
  await page.goto("/login");
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute(
    "href",
    "/manifest.webmanifest",
  );

  const response = await request.get("/manifest.webmanifest");
  expect(response.ok()).toBe(true);
  const manifest = (await response.json()) as {
    name?: string;
    short_name?: string;
    start_url?: string;
    display?: string;
    icons?: { src?: string; sizes?: string; purpose?: string }[];
  };
  expect(manifest).toMatchObject({
    name: "Hamd Foods ERP",
    short_name: "Hamd ERP",
    start_url: "/login",
    display: "standalone",
  });
  expect(manifest.icons).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ src: "/icons/icon-192.png", sizes: "192x192" }),
      expect.objectContaining({ src: "/icons/icon-512.png", sizes: "512x512" }),
      expect.objectContaining({
        src: "/icons/icon-maskable-512.png",
        sizes: "512x512",
        purpose: "maskable",
      }),
    ]),
  );
  for (const icon of manifest.icons ?? []) {
    const iconResponse = await request.get(icon.src ?? "");
    expect(iconResponse.ok()).toBe(true);
    expect(iconResponse.headers()["content-type"]).toBe("image/png");
  }
});

test("service worker preserves static assets and provides an offline fallback", async ({
  context,
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await login(page);
  await waitForServiceWorkerControl(page);

  await expect(page.getByRole("heading", { name: "Dashboard", exact: true })).toBeVisible();
  await page.screenshot({
    fullPage: true,
    path: path.join(evidenceDirectory, "dashboard-1280x800.png"),
  });

  const registration = await page.evaluate(async () => {
    const ready = await navigator.serviceWorker.ready;
    return { active: Boolean(ready.active), scope: ready.scope };
  });
  expect(registration.active).toBe(true);
  expect(registration.scope).toBe(`${new URL(page.url()).origin}/`);

  await context.setOffline(true);
  await expect(page.getByTestId("offline-notice")).toContainText(
    "No business transactions will be queued or replayed.",
  );
  expect(await page.evaluate(async () => (await fetch("/icons/icon-192.png")).ok)).toBe(true);

  await page.goto("/offline-navigation-check", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "You are offline" })).toBeVisible();
  await expect(page.getByText("No business transaction has been queued.")).toBeVisible();
  await page.screenshot({
    fullPage: true,
    path: path.join(evidenceDirectory, "offline-fallback-1280x800.png"),
  });
  await context.setOffline(false);
});

test("offline form submission is rejected without a success state or replay", async ({
  context,
  page,
}) => {
  await login(page);
  await page.goto("/accounting/manual-journals");
  await waitForServiceWorkerControl(page);
  await page.getByLabel("Journal lines JSON").fill(
    JSON.stringify([
      { accountId: "offline-test", debit: "1.000000", description: "Not submitted" },
      { accountId: "offline-test-2", credit: "1.000000", description: "Not submitted" },
    ]),
  );
  await page.getByLabel("Journal date").fill("2026-08-31");
  await page.getByLabel("Journal memo").fill("Offline submission check");

  await context.setOffline(true);
  await page.getByRole("button", { name: "Post manual journal" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("offline-notice")).toContainText(
    "Nothing was sent. Reconnect, review the form, and submit it again.",
  );
  await expect(page).toHaveURL(/\/accounting\/manual-journals$/);
  await expect(page.getByText(/journal posted/i)).toHaveCount(0);
  await context.setOffline(false);
});

async function waitForServiceWorkerControl(page: import("@playwright/test").Page) {
  await page.waitForFunction(async () => {
    if (!("serviceWorker" in navigator)) return false;
    await navigator.serviceWorker.ready;
    return Boolean(navigator.serviceWorker.controller);
  });
}
