# Runtime Performance Baseline

Captured 2026-09-08 22:22 PKT on machine `AJ`, Windows 11 Home 10.0.26200, 13th Gen Intel Core i5-13420H, Node 24.11.1. The test used the freshly seeded Phase 27 E2E database and the Playwright-managed Next.js development server on loopback.

Method: authenticate once, perform one unmeasured warm-up navigation per route, then perform three measured navigations from `performance.now()` through the first page heading becoming visible. Request counts include all same-origin document, RSC, and static-asset requests observed by the browser. There is deliberately no timing failure threshold.

## Before

| Route                                                           |  Samples (ms) | Median | Maximum | Same-origin requests |
| --------------------------------------------------------------- | ------------: | -----: | ------: | -------------------- |
| `/dashboard`                                                    | 372, 311, 252 | 311 ms |  372 ms | 17, 17, 17           |
| `/inventory/finished-goods`                                     | 464, 288, 470 | 464 ms |  470 ms | 18, 18, 18           |
| `/production/batches/[seeded-id]`                               | 547, 516, 495 | 516 ms |  547 ms | 19, 19, 19           |
| `/accounting`                                                   | 352, 552, 534 | 534 ms |  552 ms | 19, 19, 19           |
| `/accounting/reports/profit-loss?from=2026-01-01&to=2026-12-31` | 271, 260, 256 | 260 ms |  271 ms | 19, 19, 19           |

The repeated samples produced identical request counts per route, no duplicate navigation, no failed request, no 5xx response, and sub-second medians. This evidence does not demonstrate a repeated request fan-out, per-record browser request loop, or other structural bottleneck. Database query counts were not inferred from browser timings.

## Confirmed-defect decision

No confirmed performance defect; no optimization authorized.

## After

Not applicable—no confirmed bottleneck and no production performance edit was made. Future comparisons must rerun `corepack pnpm exec playwright test e2e/runtime-performance.spec.ts` against the same fixture and method.
