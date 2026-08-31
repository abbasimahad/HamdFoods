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

Database-backed tests are also separate and may run only with a disposable PostgreSQL database whose name is explicitly test-only:

```powershell
corepack pnpm test:integration
corepack pnpm test:e2e
```

The Phase 27 lifecycle owns a fixed isolated PostgreSQL cluster at `127.0.0.1:55433/factory_erp_test`. Each full suite recreates, migrates, and seeds that database. The integration guard rejects the normal `DATABASE_URL`, non-PostgreSQL URLs, and database names without a `test` token; managed commands also reject custom endpoints.

Playwright owns browser E2E only. Chromium runs a real Better Auth session against the Next.js application, with one worker, no retries, semantic locators, and failure artifacts outside the repository. See `docs/testing/e2e-test-strategy.md` for lifecycle commands, covered workflows, and boundaries.
