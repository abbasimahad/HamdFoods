# Database integration and browser E2E strategy

Phase 27 adds two deliberately separate regression layers around the existing fast Vitest suite. Both use a disposable PostgreSQL database and must never target the normal development database.

## Disposable database lifecycle

The local test lifecycle manages an isolated PostgreSQL 16 cluster at `127.0.0.1:55433`, stores its files under ignored `.test-data/`, and uses only `factory_erp_test`. Docker was unavailable in the delivery environment, so `scripts/test-database.ts` uses installed PostgreSQL server binaries instead. `POSTGRES_BIN` may identify those binaries when they are not in the standard Windows installation directories.

The database safety guard requires PostgreSQL, a database name containing a test token, and a URL different from any supplied development `DATABASE_URL`. Managed commands additionally reject any endpoint other than the fixed Phase 27 test cluster and confirm that the server on the test port owns the expected ignored data directory before mutating it.

```powershell
corepack pnpm test:db:start
corepack pnpm test:db:migrate
corepack pnpm test:db:reset
corepack pnpm test:db:seed
corepack pnpm test:db:stop
```

Reset drops only `factory_erp_test`, recreates it, deploys every migration, and seeds deterministic identities and reference/master/accounting data. Fixtures do not fabricate completed operational documents or ledger entries. The workflows create those records through application repositories and posting services.

A fresh migration run exposed PostgreSQL's rule that newly added enum values cannot be referenced before their transaction commits. Migration `20260823225900_phase13_packaging_enum_values` introduces the Phase 13 enum values in an earlier committed migration; the already-applied historical Phase 13 migration remains unchanged.

## Database-backed coverage

`corepack pnpm test:integration` resets and seeds the disposable database before running the serial Vitest integration configuration. It covers:

- purchase order approval, goods receipt, accepted/rejected QC custody, and a stock-neutral warehouse transfer;
- recipe approval, batch release, material and packaging issue/consumption, good output, completion, and final costing;
- sales order, lot allocation, dispatch, invoice, payment/reversal, inspected return, and supplier payment/reversal;
- AR, AP, inventory and WIP source-ledger-to-GL reconciliation plus balanced posted journals;
- PostgreSQL immutability triggers, duplicate reversal rejection, over-return rejection, and representative idempotency/atomicity checks.

## Chromium browser coverage

`corepack pnpm test:e2e` performs a fresh database reset, executes the same supported-service golden workflow, starts the Next.js server at `127.0.0.1:3417`, and runs Playwright with one worker and no retries. Desktop Chromium verifies real Better Auth login, invalid login, logout, protected routing, a restricted viewer, navigation across major ERP areas, and representative printable purchasing, sales, and financial pages. A Pixel 7 viewport project verifies the mobile navigation shell and reachable main content.

Locators use roles, labels, headings, and visible application text. There are no fixed sleeps. Failure screenshots, traces, and the HTML report are written to the operating-system temporary directory so runtime evidence does not dirty the repository.

## Scope boundary

These suites validate representative supported workflows; they are not exhaustive browser coverage for every form permutation. They do not connect to the development database, invent ledger rows, weaken server authorization, or introduce Phase 28 product behavior.
