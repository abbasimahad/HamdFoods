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
$env:TEST_DATABASE_URL = "postgresql://.../factory_erp_test"
pnpm test:integration
```

The integration guard rejects a missing URL, the normal `DATABASE_URL`, non-PostgreSQL URLs, and database names without a `test` token. See `docs/testing/core-test-strategy.md` for the Phase 26 boundary and remaining database-backed gaps.

Playwright is reserved for a later E2E phase. Do not add it until end-to-end workflows exist.
