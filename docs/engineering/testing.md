# Testing strategy

Vitest owns unit and server-side integration tests. Tests should exercise public behavior and protect a realistic failure rather than mirror implementation details.

Current meaningful coverage verifies:

- exact mass/volume conversion, carton normalization, piece rates, sequential discounts, production output/yield, and costing arithmetic;
- inventory reservation/dispatch/invoice limits, purchasing receipt/QC custody, production custody, and atomic insufficient-stock failures;
- purchase fulfilment, customer settlement/return credits, payment reversal effectiveness, valuation idempotency, balanced journals, accounting controls, and reversal-chain safety;
- existing access, audit, application-delegation, database-configuration, and health-check behavior.

Use focused tests while developing, then run:

```powershell
pnpm test
pnpm verify
```

`pnpm verify` checks formatting, lint, tests, Prisma schema/client generation, strict types, and the production build. Live database connectivity is intentionally separate:

```powershell
pnpm db:check
```

Phase 35 adds a dependency-vulnerability check, kept separate from `verify` because it requires live network access to the npm registry advisory database and cannot run fully offline:

```powershell
pnpm security:audit
```

This runs `pnpm audit --prod --audit-level=high` and exits non-zero on any HIGH or CRITICAL advisory in a production dependency. Run it before every release and periodically otherwise; `.github/dependabot.yml` also opens weekly update PRs, which still go through the normal `pnpm verify`/integration/E2E gates before merge. A flagged finding is not automatically a defect -- assess actual reachability from the running server (see `docs/specs/phase35-security-hardening-design.md` Section 2 for the reasoning behind several currently-accepted findings that are build-tool-only transitive dependencies, never imported by the running application).

Database-backed tests are also separate and may run only with a disposable PostgreSQL database whose name is explicitly test-only:

```powershell
corepack pnpm test:integration
corepack pnpm test:e2e
corepack pnpm backup:drill
```

The Phase 27 lifecycle owns a fixed isolated PostgreSQL cluster at `127.0.0.1:55433/factory_erp_test`. Each full suite recreates, migrates, and seeds that database. The integration guard rejects the normal `DATABASE_URL`, non-PostgreSQL URLs, and database names without a `test` token; managed commands also reject custom endpoints.

Playwright owns browser E2E only. Chromium runs a real Better Auth session against the Next.js application, with one worker, no retries, semantic locators, and failure artifacts outside the repository. See `docs/testing/e2e-test-strategy.md` for lifecycle commands, covered workflows, and boundaries.

Runtime stabilization adds two durable Playwright seams. `e2e/runtime-stability.spec.ts` observes unexpected browser console errors, uncaught page errors, failed same-origin requests, and same-origin HTTP 5xx responses while exercising major and seeded detail routes plus invalid active forms. `e2e/runtime-performance.spec.ts` performs one warm-up and three measurements without an arbitrary timing threshold:

```powershell
corepack pnpm exec playwright test e2e/runtime-stability.spec.ts
corepack pnpm exec playwright test e2e/runtime-performance.spec.ts
```

The performance baseline and decision rule are recorded in `docs/testing/runtime-performance-baseline.md`; timing alone never authorizes an optimization without repeatable structural evidence.

Phase 29 Playwright coverage also verifies the manifest and icon contract, active service-worker control, static-asset availability offline, the non-sensitive offline navigation fallback, explicit rejection of offline form submission, and representative phone/tablet shell, table, form, and safety-action layouts. Browser-controlled install-prompt presentation is not asserted because Chromium does not expose it as a stable ordinary page contract.

The Phase 28 backup drill resets the Phase 27 source test database, restores its golden workflow into the separate `factory_erp_restore_test`, and verifies checksums, source/restored facts, migrations, journals, control accounts, inventory valuation, WIP, and audit preservation. It never targets the normal `.env` database.
