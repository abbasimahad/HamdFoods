# Phase 25 Audit & Control Completion Implementation Plan

> **For agentic workers:** Use the host's available task-by-task implementation workflow. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete Phase 25 by making every supported high-risk access, purchasing, production, costing, sales, and accounting lifecycle transition emit an append-only, actor-attributed audit event in the same successful transaction.

**Architecture:** `recordAuditEvent` remains the only audit writer. Source repositories own source-document lifecycle events; the accounting writer owns JOURNAL and CONTROL_BLOCKED events, so operational posting and derived accounting do not compete as authorities. Existing module application permissions, server validation, Serializable transactions, ledger writers, and reversal documents remain authoritative.

**Tech Stack:** TypeScript, Next.js 16 server actions, Prisma 7, PostgreSQL 18, Zod, Vitest, pnpm.

## Global Constraints

- Preserve server authority, exact decimal arithmetic, ledger-based inventory/value, reversal-only correction of posted effects, immutable auditability, least privilege, and PostgreSQL as source of truth.
- Do not implement Phase 26, new posting engines, bank-statement reconciliation, refunds, fixed assets, payroll, multi-currency, tax filing, or budgeting.
- Do not expose secrets or create a Git commit; the user did not authorize commits.
- Record only successful lifecycle changes. Audit writes must share the successful business transaction, except managed-user provisioning where Better Auth creates the credential row first and the successful activation/role assignment/audit unit remains atomic; failed provisioning leaves the user inactive and sessionless.
- Cancellation/reversal/reopen/override reasons remain server-validated and attributable.

---

### Task 1: Audit core and access-control mutations

**Files:**

- Modify: `src/server/audit/audit-event.ts`
- Create: `src/server/audit/audit-event.test.ts`
- Modify: `src/modules/access/application/manage-users.ts`
- Modify: `src/modules/access/application/manage-users.test.ts`
- Modify: `src/modules/access/application/manage-role-permissions.ts`
- Modify: `src/modules/access/application/manage-role-permissions.test.ts`
- Modify: `src/server/access/prisma-access-repository.ts`

**Interfaces:**

- Consumes: `recordAuditEvent(client, AuditEventInput)`, authenticated `ApplicationPrincipal.id`.
- Produces: actor-aware `createUser(actorId, input)` and `replaceRolePermissions(actorId, roleCode, permissions)` store calls; atomic USER CREATE/ACTIVATE/DEACTIVATE/UPDATE and ROLE UPDATE events.

- [x] Add focused failing tests proving actor IDs cross the application/store boundary and proving audit metadata recursively removes password/token/secret/credential/authorization keys while CANCEL/REVERSE/REOPEN/OVERRIDE reject empty reasons.
- [x] Run `corepack pnpm vitest run src/modules/access/application/manage-users.test.ts src/modules/access/application/manage-role-permissions.test.ts src/server/audit/audit-event.test.ts`; expect assertions to fail because actor-aware store signatures and testable scrubbing are absent.
- [x] Implement the minimum actor propagation and transactional access audit writes. Snapshot role codes and active state only; never persist password or credential material.
- [x] Rerun the identical focused test; expect all tests to pass.
- [x] Run `corepack pnpm typecheck`; expect exit 0.
- [x] Record evidence without committing.

### Task 2: Purchasing lifecycle coverage

**Files:**

- Modify: `src/server/purchasing/prisma-purchasing-repository.ts`
- Modify: `src/server/purchasing/prisma-goods-receipt-repository.ts`
- Modify: `src/server/purchasing/prisma-purchase-return-repository.ts`

**Interfaces:**

- Consumes: existing actor IDs and cancellation reasons on purchase-order, GRN, QC, and purchase-return transaction methods.
- Produces: PURCHASE_ORDER APPROVE/CANCEL; GRN POST/CANCEL/COMPLETE-QC; PURCHASE_RETURN POST/CANCEL audit events.

- [x] Add a focused failing audit-contract test for the expected purchasing entity/action descriptions using the shared audit input builder introduced only if it reduces duplication; otherwise document that repository transaction inspection is the focused gate and do not create a source-grep test.
- [x] Inspect each mutation to confirm the audit call is after authoritative writes but before transaction return; failure is a lifecycle that can commit without its event.
- [x] Add the minimum `recordAuditEvent` calls, including reference numbers, reason on cancellation, compact status snapshots, and related PO/GRN references where available.
- [x] Run `corepack pnpm typecheck` and `corepack pnpm lint`; expect exit 0.
- [x] Reinspect the affected transaction bodies for same-transaction placement.
- [x] Record evidence without committing.

### Task 3: Production and costing lifecycle coverage

**Files:**

- Modify: `src/server/production/prisma-recipe-repository.ts`
- Modify: `src/server/production/prisma-production-batch-repository.ts`
- Modify: `src/server/production/prisma-production-material-repository.ts`
- Modify: `src/server/production/prisma-production-packaging-repository.ts`
- Modify: `src/server/production/prisma-production-output-repository.ts`
- Modify: `src/server/costing/prisma-inventory-valuation-repository.ts`

**Interfaces:**

- Consumes: existing actor IDs, cancellation reasons, completion explanations, valuation reasons/references, and transaction source numbers.
- Produces: recipe APPROVE/CREATE-version; batch RELEASE/CANCEL/COMPLETE; material, packaging, and output POST/CANCEL; valuation ADJUST/BACKFILL; landed-cost POST; production-cost ADJUST; cost FINALIZE audit events.

- [x] Add or extend the focused audit-helper test for required override/reason behavior used by production controls; observe the expected failure before changing behavior.
- [x] Implement audit writes inside each existing transaction, after invariant checks and authoritative ledger/document writes. Explanations are metadata unless they are mandatory reasons; quantities and values are serialized decimal strings.
- [x] Ensure costing events do not claim inventory quantity authority and do not duplicate derived JOURNAL ownership.
- [x] Run the focused test and `corepack pnpm typecheck`; expect exit 0.
- [x] Run `corepack pnpm lint`; expect exit 0.
- [x] Record evidence without committing.

### Task 4: Sales, treasury, and accounting-control coverage

**Files:**

- Modify: `src/server/sales/prisma-sales-order-repository.ts`
- Modify: `src/server/sales/prisma-sales-dispatch-repository.ts`
- Modify: `src/server/sales/prisma-sales-invoice-repository.ts`
- Modify: `src/server/sales/prisma-customer-payment-repository.ts`
- Modify: `src/server/sales/prisma-sales-return-repository.ts`
- Modify: `src/server/accounting/prisma-phase23-repository.ts`
- Modify: `src/server/accounting/transactional-accounting-posting.ts`

**Interfaces:**

- Consumes: existing sales/accounting actor IDs, reasons, delivery facts, allocation inputs, and reversal links.
- Produces: sales order APPROVE/ADJUST-reservation/CANCEL; dispatch POST/COMPLETE-delivery/CANCEL; invoice POST/CANCEL; customer payment POST/ALLOCATE/CANCEL; sales return POST-receive/COMPLETE-inspection/COMPLETE/CANCEL; supplier payment, expense, and transfer POST/ALLOCATE/CANCEL/REVERSE; JOURNAL POST and source CONTROL_BLOCKED audit events.

- [x] Add a focused failing test around the accounting audit classification helper so successful derived posting targets JOURNAL while blocked posting targets the source entity; observe the expected failure.
- [x] Implement source lifecycle events in source repositories and change the automatic accounting writer to audit JOURNAL creation plus explicit CONTROL_BLOCKED source events. Preserve related source/journal links.
- [x] Keep existing reversal reason and linked compensating-document safeguards unchanged.
- [x] Rerun the focused test, then `corepack pnpm typecheck`; expect exit 0.
- [x] Run `corepack pnpm lint`; expect exit 0.
- [x] Record evidence without committing.

### Task 5: Live control proof, documentation, and completion gate

**Files:**

- Modify: `docs/architecture/data-integrity.md`
- Modify: `docs/phases/current.md`
- Modify only if actual decisions changed: `docs/architecture/boundaries.md`

**Interfaces:**

- Consumes: final Phase 25 source state and local PostgreSQL schema.
- Produces: accurate COMPLETE gate with evidence and a Phase 26-ready boundary, without starting Phase 26.

- [x] Run a coverage review over every actor-bearing lifecycle method and inspect each corresponding transaction for an audit call or an explicitly documented central authority; any uncovered high-risk path fails the gate.
- [x] Run `corepack pnpm verify`; expect Prettier, ESLint, all Vitest tests, Prisma validation/generation, TypeScript, and Next.js production build to pass.
- [x] Run `corepack pnpm prisma migrate deploy`, `corepack pnpm prisma migrate status`, `corepack pnpm db:check`, the read-only append-only-trigger assertion, and `git diff --check`; expect all exit 0 and schema up to date.
- [x] Perform a final diff audit for secrets, duplicated authority, unscoped Phase 26 work, inaccurate docs, and missing actor/reason/source references.
- [x] Update `docs/phases/current.md` to COMPLETE only after all checks pass; mark Phase 26 READY without implementing it.
- [x] Record final evidence without committing.

## Unresolved Product Decisions

None. The existing lifecycle contracts, actor/reason requirements, audit schema, and Phase 25 gate define the observable behavior needed for completion.
