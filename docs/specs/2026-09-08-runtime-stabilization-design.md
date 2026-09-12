# Runtime stabilization design

## Status and boundary

Approved pre-Phase-33 stabilization work against baseline `292f7256eb0b13462cb87fd61be9089f12ac1ac5`. This subproject diagnoses and fixes reproducible runtime errors, the PostgreSQL concurrent-query warning, broken active actions, and measured performance defects. It does not add business workflows, alter posted transaction semantics, modify production data, or begin Phase 33.

## Evidence-first workflow

Each symptom receives an append-only evidence record containing the real command or browser flow, exit code, and decisive output. A defect must first fail through the narrowest realistic public seam. The regression test is then run unchanged after the smallest production fix. The original broader signal is rerun before the defect closes. An unexplained disappearance is not a fix.

Initial discovery covers:

- development and test server stderr, browser console errors, failed requests, and hydration errors;
- every active permission-eligible create, edit, save, post, cancel, reverse, print, and account-security action represented in navigation or major detail pages;
- the integration path that emits `Calling client.query() when the client is already executing a query`;
- representative major list/detail pages for response time, query count, duplicate work, and serialized independent reads.

Inactive planned links and missing workflows are classified in the following workflow-inventory subproject rather than treated as broken runtime actions.

## Runtime and database design

The concurrent-query warning is traced through `PrismaGoodsReceiptRepository.postGoodsReceipt()` to Prisma's expansion of a nested relation include into concurrent SELECTs on one interactive-transaction `pg.Client`. The correction enables pg's supported pipeline mode on application pool clients, making that adapter-generated concurrency valid without changing repository queries or transaction semantics. Warning suppression, arbitrary delay, and dependency pinning are prohibited.

Server errors remain observable to logs while user-facing actions return safe, specific failure feedback. Database errors, credentials, stack traces, and connection strings must not reach the browser. Existing transaction isolation, exact-decimal calculations, inventory movements, valuation, journals, reversals, RBAC checks, and audit events remain authoritative.

## Active-action verification

The audit derives active actions from rendered pages and their server-action handlers. Each action is classified as working, permission/status-disabled, intentionally unavailable, or defective. Defective actions receive a behavioral regression test at the application, integration, or browser seam that observes the failed result—not an implementation string.

Submission controls must expose pending state, prevent accidental repeat submission, and show success or safe validation/error feedback where the existing action contract supports it. This stabilization subproject fixes confirmed failures; the later shared data-entry UX subproject owns broad visual consistency and new quick-create behavior.

## Performance design

Optimization requires a before measurement against a repeatable seeded fixture. Measurements record route/action, warm-up, repetitions, elapsed time, and query count where observable. Corrections target demonstrated N+1 reads, duplicate queries, repeated server work, oversized selection, or unnecessary serialization. A change closes only when the same measurement shows improvement without changing returned business data or authorization behavior. No speculative cache, denormalization, pagination policy, or accounting shortcut is introduced.

## Verification

Focused red/green commands are selected per defect. The integrated runtime gate is:

```powershell
corepack pnpm test
corepack pnpm test:integration
corepack pnpm test:e2e
corepack pnpm verify
```

Browser coverage checks active actions, failed validation, duplicate-submit resistance, redirects, and browser/server error logs. Integration output must contain no PostgreSQL concurrent-client-query warning. Performance evidence must show paired before/after results for every optimization claim.

Runtime stabilization passes only when all reproduced defects are fixed, all active actions audited, no known Node/server or browser-console application error remains in the exercised flows, the PostgreSQL warning is absent, affected tests pass, and accounting/inventory/posting/reversal/RBAC/audit behavior remains unchanged.

## Deliverables and handoff

- Regression tests and minimal fixes for every reproduced runtime defect.
- Active-action audit with explicit classifications and no untracked broken action.
- Paired evidence for each measured performance correction.
- Updated testing or operational documentation only when a durable contract changes.
- A runtime-stabilization report that lists fixed defects, clean signals, measurements, test results, and any unverified environment boundary.

After this subproject passes, work proceeds to workflow inventory. Navigation reconciliation, shared data-entry UX, partial workflows, and missing engines remain separate later subprojects.
