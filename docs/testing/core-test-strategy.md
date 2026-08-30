# Core test strategy

Vitest remains the single automated test framework. Fast `src/**/*.test.ts` files run in Node and exercise exact domain math plus public transactional services with deterministic in-memory boundary doubles. Assertions target quantities, ledger movements, valuation state, journal lines, authorization, audit behavior, and typed failures rather than UI text.

## Covered invariant groups

- quantity conversion, carton normalization, exact piece rates, sequential discounts, and totals;
- reservation, dispatch, invoice outflow, purchasing/QC custody, production material custody, fulfilment, output, yield, and packaging reconciliation;
- customer settlement, payment effectiveness and as-of reversal semantics;
- moving weighted-average valuation, zero-balance cleanup, source idempotency, batch costing, and rounding allocation;
- balanced automatic/direct journals, valuation-based COGS, customer-payment reversal reconciliation, control-account rejection, reversal-chain safety, audit scrubbing, and access control.

## Integration database

Database integration tests use `vitest.integration.config.ts` and require an explicit `TEST_DATABASE_URL`. The guard rejects a missing URL, a URL equal to `DATABASE_URL`, a non-PostgreSQL URL, or a database name that is not explicitly test-only. The normal development database must never be used as a shortcut.

```powershell
$env:TEST_DATABASE_URL = "postgresql://.../factory_erp_test"
corepack pnpm test:integration
```

The safety/configuration foundation is ready, but no dedicated test database is configured in the repository environment, so database-backed workflow and PostgreSQL-trigger suites remain a later execution gap.

## Verification and remaining gaps

Run `corepack pnpm verify` for formatting, lint, unit/service tests, Prisma validation and generation, TypeScript, and the production build. Database-backed end-to-end workflow coverage remains blocked until a disposable migrated test database is provisioned. Browser E2E remains outside Phase 26.

No production defect was proven during the constrained implementation pass. The costing and return-inspection calculations were extracted into domain seams without changing their established rules so their exact behavior can be tested directly.

Remaining database-backed gaps are full warehouse-transfer and internal-carrying-value workflows; supplier payment/allocation/reversal ledger reconciliation; combined AR/AP/inventory/WIP source-ledger-to-GL reconciliation; and execution of PostgreSQL append-only triggers. These are not run against the development database.

Phase 27 may start only after Phase 26 verification passes; it must not weaken the server-authoritative, ledger, reversal, audit, or test-database safety boundaries.
