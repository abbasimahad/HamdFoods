# Runtime Stabilization Implementation Plan

> **For agentic workers:** Use the host's available task-by-task implementation workflow. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove proven runtime defects and establish repeatable evidence that active ERP surfaces run without the PostgreSQL concurrent-query warning, known Node/server failures, browser application errors, broken active actions, or unmeasured performance changes.

**Architecture:** Keep the existing modular-monolith and transaction boundaries. Fix the known warning at the verified Prisma/pg adapter boundary, add browser/runtime observation around representative active workflows, and optimize only a route whose repeatable before measurement proves duplicate/N+1 or avoidable sequential work. Each newly discovered defect becomes a separately recorded red/green item before its source changes.

**Tech Stack:** TypeScript, Next.js 16.3 App Router, React 19 server actions, Prisma 7.9.1 with `@prisma/adapter-pg`, PostgreSQL 16, Vitest 4.1, Playwright Chromium, pnpm 11.22.

## Global Constraints

- Work only on runtime stabilization; do not change navigation status, add planned workflows, redesign data-entry screens, modify production data, and do not begin Phase 33.
- Prove the exact shared-client call path before changing any data-layer code. The captured baseline stack is `pg Client.query` -> `@prisma/adapter-pg PgTransaction.performIO` -> Prisma transaction interpreter. The initial application-level overlap hypothesis must be revised if the traced gate exposes Prisma-generated relation reads.
- For every defect: reproduce, add a failing behavioral regression test, apply the smallest safe fix, rerun the identical test, run affected integration/E2E coverage, and append exact evidence.
- Preserve server-authoritative decisions, exact decimals, PostgreSQL truth, inventory ledgers, journal balance, reversals, immutable audit history, RBAC, and non-secret errors.
- Performance work requires the same seeded fixture and paired before/after route timing plus query/call evidence where observable. A subjective impression is not authorization to optimize.
- Read the installed Next.js App Router guides `node_modules/next/dist/docs/01-app/02-guides/server-actions.md`, `node_modules/next/dist/docs/01-app/01-getting-started/10-error-handling.md`, and `node_modules/next/dist/docs/01-app/02-guides/testing/playwright.md` before changing any Next.js action or browser-bound code.
- Keep execution in the main Codex session. Do not delegate to subagents.
- Do not create intermediate commits. Commit and push only after every runtime gate passes, as part of the user's eventual combined delivery.
- If discovery exposes another defect, append a concrete defect task to this plan with its exact reproduction, owned paths, expected failing assertion, minimum fix, and affected checks before modifying its source.

---

### Task 1: Remove the concurrent-query warning at the verified Prisma/pg boundary

**Files:**

- Modify: `src/test/database.integration.test.ts`
- Modify: `src/server/db/prisma.ts`
- Evidence: `C:/Users/abdul/AppData/Local/Temp/hamdfoods-complete-ux-20260908.md`

**Interfaces:**

- Consumes: Prisma relation loads issued through `@prisma/adapter-pg` on an interactive transaction client.
- Produces: the unchanged Prisma repository/domain contracts with supported pg pipeline mode enabled for Prisma-generated concurrent relation SELECTs.

- [x] **Step 1: Record the proven call path**

Append the traced baseline command and decisive stack to the durable evidence log:

```powershell
$env:NODE_OPTIONS = '--trace-deprecation'
corepack pnpm test:integration
```

The baseline included the warning text plus `Client.query` and `PgTransaction.performIO`. A temporary ordered-read change at `postAutomaticJournal()` removed one application overlap but did not remove the traced integration warning, disproving that call site as the complete cause.

- [x] **Step 2: Minimize and add the focused failing integration test**

Instrument the installed pg client only for diagnosis, isolate the first warning to the nested goods-receipt relation load, then remove the instrumentation. Add `loads transaction relations without overlapping an unsupported pg client` to `src/test/database.integration.test.ts`, exercising that exact relation include inside `prisma.$transaction()` and asserting the pg deprecation warning is absent.

- [x] **Step 3: Verify the relevant failure**

Run:

```powershell
corepack pnpm exec vitest run src/test/database.integration.test.ts
```

Observed before the fix: nonzero exit; the nested relation query emitted the exact concurrent `client.query()` warning and the assertion failed.

- [x] **Step 4: Implement the minimum behavior**

Enable the supported `pipeline: true` option on the pg pool used by `PrismaPg`. Do not alter relation queries, repository results, transaction isolation, ledgers, journals, reversals, RBAC, or audit behavior. Revert exploratory application-level serializations because they did not address Prisma-generated concurrent relation SELECTs.

- [x] **Step 5: Verify focused and integration passes**

Run the identical focused integration command; expect both tests in the file to pass. Then run:

```powershell
$output = & {
  $env:NODE_OPTIONS = '--trace-deprecation'
  corepack pnpm test:integration
} 2>&1
$exitCode = $LASTEXITCODE
$output | Write-Output
if ($exitCode -ne 0) { exit $exitCode }
if ($output -match 'Calling client\.query\(\) when the client is already executing a query') {
  throw 'Concurrent pg Client.query warning remains.'
}
```

Observed: 14 integration tests passed, the infrastructure-gated payload test remained explicitly skipped, and the warning pattern was absent.

- [x] **Step 6: Review the task diff**

Confirmed the durable source change is limited to pg pool capability plus the focused integration regression; exploratory instrumentation and serializations were removed. `git diff --check` passed. Do not commit.

---

### Task 1A: Superseded diagnostic branch — application serialization

This branch was recorded before the exact nested-relation source was known. Diagnosis proved Prisma itself expands a single relation include into concurrent SELECTs, so repository-wide application serialization would not satisfy the warning contract and was not retained.

- [x] **Step 1: Preserve the second red result**

The unchanged traced integration command after Task 1 exited nonzero through the warning assertion while all 13 integration tests passed. Record that result as proof that `postAutomaticJournal()` was one real overlap but not the only reachable source.

- [x] **Step 2: Test the application-serialization hypothesis**

Temporary ordered-read changes were tested and the integration warning remained. The hypothesis was falsified; all exploratory edits were reverted before the boundary fix in Task 1.

- [x] **Step 3: Verify the warning is absent at the corrected boundary**

Run the exact traced integration warning-assertion command from Task 1 Step 5. Expected: exit 0, 13 integration tests pass, one installer payload integration test remains explicitly gated, and the warning pattern is absent.

- [x] **Step 4: Verify affected domain behavior**

Run:

```powershell
corepack pnpm exec vitest run src/server/accounting/transactional-accounting-posting.test.ts src/server/inventory/transactional-inventory-posting.test.ts src/server/purchasing/purchasing-fulfilment.test.ts src/modules/production/domain/production-integrity.test.ts src/modules/accounting/domain/reversal-integrity.test.ts src/server/sales/payment-integrity.test.ts
```

Expected: all focused accounting, inventory, purchasing, production, reversal, and payment tests pass unchanged.

- [x] **Step 5: Review the task diff**

Confirmed no exploratory repository scheduling change remained; pooled behavior is handled at the adapter-supported pg boundary and `git diff --check` passed. Do not commit.

---

### Task 2: Establish browser/runtime error observation and audit active navigation surfaces

**Files:**

- Create: `e2e/runtime-observation.ts`
- Create: `e2e/runtime-stability.spec.ts`
- Create: `docs/testing/runtime-action-audit.md`
- Modify only if a reproduced defect requires it: add a new exact defect task to this plan before the source edit
- Evidence: `C:/Users/abdul/AppData/Local/Temp/hamdfoods-complete-ux-20260908.md`

**Interfaces:**

- Produces: `observeRuntime(page: Page): RuntimeObservation` where `RuntimeObservation` exposes `assertClean(): void` and records unexpected browser `console.error`, `pageerror`, failed requests, and HTTP 5xx responses.
- Consumes: existing `login(page)`, `Phase27WorkflowState`, seeded IDs in `.test-data/phase27-e2e-state.json`, and current active navigation configuration.

- [x] **Step 1: Add the observation helper test first**

Create `runtime-observation.ts` with the proposed public interface and an intentionally behavior-free `assertClean()` scaffold, then create a test in `e2e/runtime-stability.spec.ts` that installs `observeRuntime(page)`, emits a synthetic browser `console.error('runtime-observer-probe')`, and expects `assertClean()` to throw with that message. The scaffold is not a usable implementation and exists only to establish a behavior-level red result; it must be replaced immediately after the expected assertion failure.

Run:

```powershell
corepack pnpm test:e2e
```

Expected: nonzero exit because `assertClean()` did not report `runtime-observer-probe`; database reset, migration, seed, and all unrelated existing checks must reach their normal setup rather than causing the failure.

- [x] **Step 2: Implement the minimum observation helper**

`observeRuntime` must:

- subscribe before navigation to `console`, `pageerror`, `requestfailed`, and `response`;
- record only `console.error`, uncaught page errors, failed same-origin application requests, and same-origin responses with status 500–599;
- ignore browser-extension/devtools traffic and the test's explicitly named probe only after the red test has been changed to assert a clean ordinary page;
- sanitize recorded URLs to origin/path and never capture cookies, request bodies, credentials, or query secrets;
- remove listeners when `assertClean()` completes so later tests do not inherit state.

Rerun the identical focused browser command; expect pass.

- [x] **Step 3: Add representative active-surface coverage**

In `runtime-stability.spec.ts`, log in as the seeded administrator and visit:

- major roots: `/dashboard`, `/inventory`, `/purchasing`, `/production`, `/sales`, `/accounting`, `/reports`, `/administration`, `/account/security`;
- seeded details: purchase order, GRN, production batch/materials/packaging/output/costing, sales order, dispatch, invoice, payment, return, accounting journal, supplier payment, and customer/supplier statements using IDs from `Phase27WorkflowState`;
- active create/edit routes already exposed by the UI, without submitting valid mutations in this read/navigation test.

For every route assert a successful response, the expected page heading or document identity, and `assertClean()`. Add a separate invalid-submit test for representative master, multi-line transaction, and lifecycle action forms; assert visible validation feedback, no redirect to a success state, no 5xx response, and a clean runtime observation.

- [x] **Step 4: Produce the active-action audit**

Create `docs/testing/runtime-action-audit.md` with one row per active navigation/detail action grouped by Dashboard, Inventory/Masters, Purchasing/QC, Production/Costing, Sales/Dispatch/Invoices/Returns/Payments, Accounting/Reports, Administration, and Account Security. Each row records route, visible action, permission/status precondition, evidence test or existing integration seam, and one classification: `WORKING`, `DISABLED BY CONTRACT`, `INTENTIONALLY UNAVAILABLE`, or `DEFECT`.

Do not mark planned navigation links as broken; list them as outside runtime stabilization and hand them to workflow inventory. Any `DEFECT` blocks this task and invokes the global defect-task rule before source modification.

- [x] **Step 5: Run affected E2E coverage**

Run:

```powershell
corepack pnpm test:e2e
```

Expected: all existing and new Chromium checks pass with zero retry, no unexpected 5xx, no captured browser application errors, and no failed same-origin requests. Review command output for Node unhandled errors or stack traces; any occurrence becomes a defect task rather than an ignored log line.

- [x] **Step 6: Review the task diff**

Read the new helper, spec, and audit completely; verify the helper cannot record secrets and the audit has no unclassified active action. Run `git diff --check`. Do not commit.

---

### Task 2A: Remove the reproducible Playwright server color-environment warning

**Files:**

- Create: `src/test/playwright-config.test.ts`
- Modify: `playwright.config.ts`

**Reproduction:** Every Playwright run inherits host `NO_COLOR=1` while Playwright sets `FORCE_COLOR` for its child server, causing repeated Node warnings that `NO_COLOR` is ignored.

- [x] Add a focused config regression that sets `NO_COLOR`, imports the Playwright config, and asserts the inherited variable is removed before child-server environment construction.
- [x] Run the focused test and record the expected failure.
- [x] Delete `process.env.NO_COLOR` at the Playwright config boundary before calling `phase27TestEnvironment()`; do not alter application runtime environment handling.
- [x] Rerun the focused test and the runtime Playwright spec; require the warning text to be absent.

---

### Task 3: Measure representative route performance and fix only confirmed defects

**Files:**

- Create: `e2e/runtime-performance.spec.ts`
- Create: `docs/testing/runtime-performance-baseline.md`
- Modify only after a confirmed bottleneck: append a defect task with exact owned source/test paths before editing production code
- Evidence: `C:/Users/abdul/AppData/Local/Temp/hamdfoods-complete-ux-20260908.md`

**Interfaces:**

- Produces: a `RouteMeasurement` record `{ route, repetitions, medianMs, maxMs, observedRequests }` for authenticated seeded routes.
- Consumes: the seeded E2E server, administrator login, `performance.now()`, and same-origin request events.

- [x] **Step 1: Add deterministic measurement collection**

Create a Playwright spec tagged `@runtime-performance` that performs one warm-up and three measured visits for `/dashboard`, `/inventory/finished-goods`, `/production/batches/<seeded-id>`, `/accounting`, and `/accounting/reports/profit-loss?from=2026-01-01&to=2026-12-31`. Measure navigation start through the expected heading becoming visible, count same-origin requests, and attach JSON `RouteMeasurement[]` to the Playwright result. Do not fail on an arbitrary time threshold.

- [x] **Step 2: Capture the before baseline**

Run the performance spec alone against a freshly reset/seeded E2E database and record machine/time, warm-up, three samples, median, maximum, and request count in `docs/testing/runtime-performance-baseline.md` under `Before`. Inspect the traced code path only when the samples show repeatable duplicated requests, a per-record query loop, or avoidable serial independent reads.

- [x] **Step 3: Apply the confirmed-defect gate**

If no repeatable structural defect is observed, record `No confirmed performance defect; no optimization authorized` and make no production performance edit.

If a defect is observed, append a concrete task to this plan before editing. That task must name the route, query/request evidence, exact source and test files, failing regression signal, minimum change, preserved business result, and identical before/after command. A timing reduction alone is insufficient if the returned data or permissions differ.

- [x] **Step 4: Capture paired after evidence**

For every appended performance fix, rerun the identical performance command on the same fixture and record `After` samples plus the absolute and percentage median difference. Run the affected functional test and assert the same visible data/authorization result. If no fix was authorized, mark the after section `Not applicable—no confirmed bottleneck` rather than inventing an improvement.

- [x] **Step 5: Review the task diff**

Confirm the measurement test has no flaky time threshold, the document distinguishes observations from fixes, and every claimed improvement has paired evidence. Run `git diff --check`. Do not commit.

---

### Task 4: Close the runtime-stabilization gate

**Files:**

- Modify: `docs/specs/2026-09-08-runtime-stabilization-design.md` only if implementation evidence changes its durable contract
- Modify: `docs/engineering/testing.md` to name the runtime observation/performance commands if they become durable gates
- Modify: `docs/phases/current.md` with final runtime-stabilization evidence, without declaring or starting Phase 33
- Evidence: `C:/Users/abdul/AppData/Local/Temp/hamdfoods-complete-ux-20260908.md`

**Interfaces:**

- Consumes: all focused red/green evidence, the action audit, performance baseline, and final repository state.
- Produces: a runtime-stabilization result containing explicit `NONE`/`PASS` statements for every approved completion condition.

- [x] **Step 1: Run focused regression gates**

Rerun every focused test command recorded by Tasks 1–3. Expected: all exit 0; the traced integration output contains no concurrent-client warning; no required test is silently skipped.

- [x] **Step 2: Run integrated verification**

Run in this order:

```powershell
corepack pnpm test
corepack pnpm test:integration
corepack pnpm test:e2e
corepack pnpm verify
git diff --check
```

Expected: every command exits 0. The known conditional installer payload skips remain reported as infrastructure-gated and do not replace their established installer evidence.

- [x] **Step 3: Check final runtime evidence**

Confirm:

- PostgreSQL concurrent-query warning: `NONE` in a fresh traced integration run;
- known Node/server errors: `NONE` in exercised test-server output;
- known browser-console app errors: `NONE` from the runtime observer;
- broken active actions: `NONE` in the complete action audit;
- confirmed performance defects: paired fixes recorded, or explicitly none confirmed;
- accounting, inventory, posting, reversal, RBAC, and audit integration assertions still pass.

- [x] **Step 4: Update durable project evidence**

Update testing/current-phase documentation with exact counts and commands. Do not change the Phase 33 boundary. Append command, exit code, and decisive output to the external durable state log.

- [x] **Step 5: Self-review and handoff**

Read every changed file, verify no unrelated feature/navigation/data-entry work entered the diff, and report runtime stabilization before proceeding to workflow inventory. Do not commit yet; the user requested one eventual combined commit after all approved subprojects pass.

### Closure result

`COMPLETE` on 2026-09-09. Final evidence: traced integration 14 passed / 1 infrastructure-gated skip with no concurrent-query warning; Playwright 17/17 passed with clean runtime observation; `corepack pnpm verify` passed 226 unit tests / 2 skipped, TypeScript, Prisma, formatting, ESLint, and the 78-page production build; `git diff --check` passed. The canonical scheduled runtime was stopped for the established port-clear build maintenance window and restored afterward. Workflow inventory then proceeded read-only in `docs/testing/workflow-inventory.md`; no planned workflow or Phase 33 implementation began.

## Unresolved Product Decisions

None. Newly discovered defects are evidence-dependent engineering work and must be concretized in this plan before their source changes; they do not authorize new product behavior.
