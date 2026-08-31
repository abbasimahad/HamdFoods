import os from "node:os";
import path from "node:path";
import { defineConfig, devices } from "@playwright/test";

import { PHASE27_E2E_BASE_URL, phase27TestEnvironment } from "./src/test/test-environment";

Object.assign(process.env, phase27TestEnvironment());

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  outputDir: path.join(os.tmpdir(), "factory-erp-phase27-playwright-artifacts"),
  reporter: [
    ["list"],
    [
      "html",
      {
        open: "never",
        outputFolder: path.join(os.tmpdir(), "factory-erp-phase27-playwright-report"),
      },
    ],
  ],
  use: {
    baseURL: PHASE27_E2E_BASE_URL,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium-desktop",
      testIgnore: /mobile[\\/]/,
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "chromium-mobile",
      testMatch: /mobile[\\/].*\.spec\.ts/,
      use: { ...devices["Pixel 7"] },
    },
  ],
  webServer: {
    command: "corepack pnpm test:e2e:server",
    url: PHASE27_E2E_BASE_URL,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
