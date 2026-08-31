# Core test strategy

Vitest remains the single automated test framework. Fast `src/**/*.test.ts` files run in Node and exercise exact domain math plus public transactional services with deterministic in-memory boundary doubles. Assertions target quantities, ledger movements, valuation state, journal lines, authorization, audit behavior, and typed failures rather than UI text.

## Covered invariant groups

- quantity conversion, carton normalization, exact piece rates, sequential discounts, and totals;
- reservation, dispatch, invoice outflow, purchasing/QC custody, production material custody, fulfilment, output, yield, and packaging reconciliation;
- customer settlement, payment effectiveness and as-of reversal semantics;
- moving weighted-average valuation, zero-balance cleanup, source idempotency, batch costing, and rounding allocation;
- balanced automatic/direct journals, valuation-based COGS, customer-payment reversal reconciliation, control-account rejection, reversal-chain safety, audit scrubbing, and access control.

## Integration database

Database integration tests use `vitest.integration.config.ts` and the Phase 27 disposable PostgreSQL lifecycle. The guard rejects a URL equal to `DATABASE_URL`, a non-PostgreSQL URL, or a database name that is not explicitly test-only. Managed commands are restricted to the fixed isolated cluster and the normal development database must never be used as a shortcut.

```powershell
corepack pnpm test:integration
```

The integration suite recreates and migrates the test database, seeds reference data, and creates representative completed transactions only through supported repositories and posting services. It exercises multi-ledger workflows and PostgreSQL immutability triggers that in-memory tests cannot prove.

## Verification and remaining gaps

Run `corepack pnpm verify` for formatting, lint, unit/service tests, Prisma validation and generation, TypeScript, and the production build. Run `corepack pnpm test:integration` and `corepack pnpm test:e2e` separately because they reset and mutate only the disposable database.

No production defect was proven during the constrained implementation pass. The costing and return-inspection calculations were extracted into domain seams without changing their established rules so their exact behavior can be tested directly.

Phase 27 closes the previously listed warehouse-transfer, supplier reversal, combined control reconciliation, and PostgreSQL-trigger execution gaps for a representative golden workflow. Remaining breadth is exhaustive form permutations, concurrent posting races, and cross-browser coverage; those are not implied by the golden regression.

The database and browser suites preserve the server-authoritative, ledger, reversal, audit, and test-database safety boundaries. See `e2e-test-strategy.md` for Phase 27 details.
