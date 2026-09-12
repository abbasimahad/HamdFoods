import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";

import type { Phase27WorkflowState } from "../src/test/phase27-golden-workflow";
import { PHASE27_E2E_BASE_URL } from "../src/test/test-environment";
import { login } from "./fixtures";
import { e2eStatePath } from "./state";

type RouteMeasurement = {
  route: string;
  repetitions: number;
  samplesMs: number[];
  medianMs: number;
  maxMs: number;
  observedRequests: number[];
};

test("@runtime-performance records representative authenticated route baselines", async ({
  page,
}, testInfo) => {
  const state = JSON.parse(readFileSync(e2eStatePath, "utf8")) as Phase27WorkflowState;
  const routes = [
    "/dashboard",
    "/inventory/finished-goods",
    `/production/batches/${state.batchId}`,
    "/accounting",
    "/accounting/reports/profit-loss?from=2026-01-01&to=2026-12-31",
  ];
  const origin = new URL(PHASE27_E2E_BASE_URL).origin;
  const results: RouteMeasurement[] = [];

  await login(page);
  for (const route of routes) {
    await page.goto(route);
    await expect(page.locator("h1").first()).toBeVisible();

    const samplesMs: number[] = [];
    const observedRequests: number[] = [];
    for (let repetition = 0; repetition < 3; repetition += 1) {
      let requestCount = 0;
      const countRequest = (request: { url(): string }) => {
        if (new URL(request.url()).origin === origin) requestCount += 1;
      };
      page.on("request", countRequest);
      const startedAt = performance.now();
      const response = await page.goto(route);
      expect(response?.ok(), route).toBe(true);
      await expect(page.locator("h1").first(), route).toBeVisible();
      samplesMs.push(Math.round(performance.now() - startedAt));
      observedRequests.push(requestCount);
      page.off("request", countRequest);
    }

    const sorted = [...samplesMs].sort((left, right) => left - right);
    results.push({
      route,
      repetitions: samplesMs.length,
      samplesMs,
      medianMs: sorted[1]!,
      maxMs: Math.max(...samplesMs),
      observedRequests,
    });
  }

  const body = JSON.stringify(results, null, 2);
  console.log(`RUNTIME_PERFORMANCE_BASELINE ${body}`);
  await testInfo.attach("runtime-performance-baseline", {
    body,
    contentType: "application/json",
  });
});
