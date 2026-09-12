# Navigation Reconciliation and Data Entry UX Implementation Plan

> **For agentic workers:** Use the host's available task-by-task implementation workflow. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every existing workflow easy to reach and standardize safe, searchable, single-submit data entry while adding first-class receivables, payables, material-issue, and packaging-consumption workbenches over existing authoritative engines.

**Architecture:** Add small reusable presentation primitives, purpose-built read-only workbench contracts, and route adapters that call existing application use cases and repositories. Receivable/payable balances remain derived from authoritative subledgers; production workbenches reuse the existing batch material/packaging mutation engines. Adopt the UX incrementally across existing forms without changing posting, inventory, costing, accounting, reversal, or audit authority.

**Tech Stack:** TypeScript 6, Next.js 16.3 App Router and Server Actions, React 19, Tailwind CSS 4, Prisma 7.9 with PostgreSQL 16, `decimal.js`, Vitest 4, and Playwright 1.62.

## Global Constraints

- Preserve every existing runtime-stabilization change in the dirty worktree. Do not reset, discard, overwrite, or commit unrelated user changes.
- Follow `docs/specs/2026-09-09-navigation-data-entry-ux-design.md` exactly. Any product-level departure requires user approval and a spec amendment before implementation.
- Read the installed Next.js guides `node_modules/next/dist/docs/01-app/02-guides/server-actions.md`, `node_modules/next/dist/docs/01-app/01-getting-started/10-error-handling.md`, and `node_modules/next/dist/docs/01-app/02-guides/testing/playwright.md` before changing server actions or browser-bound code.
- PostgreSQL and existing ledgers remain the source of truth. Money and precise quantities stay decimal strings and use existing `decimal.js` calculations.
- Receivables are created only by authoritative sales invoice/return flows. Payables are created only by the existing purchasing/posting model. Never add manual receivable/payable creation, editable balances, or UI-owned balance calculations.
- Material Issues and Packaging Consumption reuse `save/post/cancelMaterialTransaction` and `save/post/cancelPackagingTransaction` plus their Prisma repositories. Do not create a second posting engine.
- `Purchase Invoices` and Administration `Settings` remain `MISSING`; `Reprocess` and `Waste & Damage` remain `PARTIAL`. Do not implement or relabel them complete.
- Remove the duplicate `Journal Vouchers` navigation entry and retain `Manual Journals` as the sole manual-journal workflow.
- Quick-create uses existing master-data use cases and permissions, preserves unsaved parent-form state, returns a sanitized option, and never weakens master validation.
- Client single-flight protection prevents repeated UI dispatch. Existing database constraints, transaction isolation, lifecycle validation, and source-idempotency remain the server backstop; do not add a generic idempotency table in this scope.
- No Phase 33 work. Commit and push only through the separately authorized final-closure gate after all verification succeeds.
- Every task follows red → green: add the focused failing test, observe the relevant failure, implement the minimum behavior, rerun the identical test, run affected coverage, review the task diff, and run `git diff --check`.

---

### Task 1: Add shared data-entry interaction primitives

**Files:**

- Create: `src/components/ui/data-entry-state.ts`
- Create: `src/components/ui/data-entry-state.test.ts`
- Create: `src/components/ui/action-feedback.tsx`
- Create: `src/components/ui/form-actions.tsx`
- Create: `src/components/ui/page-actions.tsx`
- Create: `src/components/ui/pending-button.tsx`
- Create: `src/components/ui/searchable-select.tsx`
- Create: `src/components/ui/line-editor-controls.tsx`
- Modify: `src/app/globals.css`
- Modify: `src/components/layout/page-header.tsx`
- Modify: `src/components/inventory/inventory-posting-form.tsx`
- Test: `src/components/ui/data-entry-state.test.ts`
- Browser test: `e2e/data-entry-ux.spec.ts` (created in this task and extended later)

**Interfaces:**

- Produces: `SelectOption = { value: string; label: string; keywords?: string }`.
- Produces: `filterSelectOptions(options, query): readonly SelectOption[]` with case-insensitive trimmed matching over label and keywords.
- Produces: `nextActiveOptionIndex(current, direction, count): number` for ArrowUp/ArrowDown navigation without selecting disabled or absent entries.
- Produces: `createLineKey(): string` for stable client row identity independent of submitted array indexes.
- Produces: `createSingleFlightGuard(): { enter(): boolean; leave(): void; active(): boolean }`; `enter()` returns `true` once and `false` until `leave()`.
- Produces: `SearchableSelect` controlled by `value` and `onValueChange`, backed by a named hidden input so existing `FormData` server actions are unchanged.
- Produces: `FormActions`, `PageActions`, `PendingButton`, `ActionFeedback`, and `LineEditorControls` presentation contracts.
- Extends `PageHeader` with optional `actions: ReactNode`; existing callers render unchanged when it is omitted.
- Adds `--control-border: #89968e` for perceptible white-ground input boundaries; existing structural `--border` remains unchanged.

- [x] **Step 1: Add focused failing state tests**

Create Node-only Vitest cases that assert:

- search trims and matches code/name keywords case-insensitively, returns all options for an empty query, and returns an empty array without inventing an option;
- active-index movement wraps predictably for nonempty lists and returns `-1` for an empty list;
- the single-flight guard accepts the first call, rejects a second call before release, and accepts again after release;
- line keys generated by the helper are stable and unique after removing a middle row and adding another row.

Run: `corepack pnpm exec vitest run src/components/ui/data-entry-state.test.ts`
Expected: nonzero exit because the new exported helpers do not exist.

- [x] **Step 2: Implement pure state and shared presentation components**

Implement the interfaces above. `SearchableSelect` must expose an actual labeled combobox with `aria-expanded`, `aria-controls`, `aria-activedescendant`, keyboard Arrow/Home/End/Enter/Escape behavior, a no-results message, blur-safe option selection, and focus restoration. Required fields reject an empty selection through the existing form/server validation; optional fields expose Clear.

`PendingButton` must synchronously acquire the single-flight guard before dispatch, remain disabled for React's pending interval, change to the supplied pending label, and release after success/error navigation settles. `FormActions` renders one submit button and a non-submit Cancel link/button. `ActionFeedback` uses `role="alert"` for errors and polite status for success. `LineEditorControls` labels Add Line/Add Item and Remove explicitly.

- [x] **Step 3: Add the focused browser contract**

In `e2e/data-entry-ux.spec.ts`, exercise the real inventory adjustment/transfer form after replacing one of its long item/warehouse selectors with `SearchableSelect` and its submit controls with the shared primitives. Do not create a demo or harness route. Assert keyboard search/selection, no-results text, Escape/focus return, lifecycle-correct Post pending text, Cancel/reset without mutation, and rapid double click/Enter producing one server-action dispatch.

Run: `corepack pnpm test:e2e`
Expected before wiring: the new UX spec fails on missing combobox/pending/single-flight behavior while existing E2E checks continue to pass.

- [x] **Step 4: Verify the task**

Run:

```powershell
corepack pnpm exec vitest run src/components/ui/data-entry-state.test.ts
corepack pnpm test:e2e
git diff --check
```

Expected: focused helper tests and the initial UX browser contract pass with no runtime observer error. Review every new component for keyboard/focus semantics and confirm it owns presentation only.

---

### Task 2: Add permission-safe in-context quick-create

**Files:**

- Create: `src/modules/workflow-ux/application/quick-create-contracts.ts`
- Create: `src/server/quick-create/quick-create-dispatch.ts`
- Create: `src/server/quick-create/quick-create-dispatch.test.ts`
- Create: `src/app/(erp)/quick-create/actions.ts`
- Create: `src/components/quick-create/quick-create-dialog.tsx`
- Create: `src/components/quick-create/quick-create-fields.tsx`
- Modify: `src/app/(erp)/sales/actions.ts`
- Modify: `src/app/(erp)/purchasing/suppliers/actions.ts`
- Modify: `src/app/(erp)/inventory/raw-materials/actions.ts`
- Modify: `src/app/(erp)/inventory/packaging-materials/actions.ts`
- Modify: `src/app/(erp)/inventory/finished-goods/actions.ts`
- Modify: `src/components/purchasing/purchase-order-form.tsx`
- Modify: `src/components/production/recipe-form.tsx`
- Modify: `src/components/sales/sales-order-form.tsx`
- Modify: `src/components/sales/customer-payment-form.tsx`
- Test: `src/server/quick-create/quick-create-dispatch.test.ts`
- Browser test: `e2e/data-entry-ux.spec.ts`

**Interfaces:**

- Produces: `QuickCreateKind = "customer" | "supplier" | "product" | "material" | "packaging"`.
- Produces: `QuickCreateOption = { value: string; label: string }` and `QuickCreateResult = { ok: true; option: QuickCreateOption } | { ok: false; message: string }` without depending on presentation-layer types.
- Produces: `QuickCreateDependencies` with one adapter per existing use case: `saveCustomer`, `saveSupplier`, and `saveItem` receiving the authenticated principal plus the existing input shape and returning the existing mutation result.
- Produces: `dispatchQuickCreate(actor, kind, data, dependencies): Promise<QuickCreateResult>` as cross-module application orchestration over injected existing use-case adapters.
- Produces: `quickCreateAction(previous, formData): Promise<QuickCreateResult>` that independently checks permission, calls `dispatchQuickCreate`, and never accepts a repository or action name from the client.
- Consumes: existing customer/supplier/item input shapes; product locks `itemType=FINISHED_GOOD`, material locks `RAW_MATERIAL`, and packaging locks `PACKAGING_MATERIAL` on the server rather than trusting hidden client values.
- Produces: `QuickCreateDialog` callback `onCreated(option)`; success inserts and selects the option, failure stays open, and Cancel returns focus without changing the parent.

- [x] **Step 1: Add focused failing quick-create tests**

Test the dispatch seam with injected use-case adapters:

- each kind calls exactly its existing create use case and returns only `{ id, label }`;
- item kinds override a forged client `itemType` with the kind's fixed type;
- inactive/unauthorized principals return the existing non-secret permission message without calling a repository (`sales.manage` for Customer, `purchasing.manage` for Supplier, and `inventory.manage` for Product/Material/Packaging);
- validation/uniqueness failures remain errors and do not add an option;
- double dispatch through the shared guard calls the create seam once.

Run: `corepack pnpm exec vitest run src/server/quick-create/quick-create-dispatch.test.ts`
Expected: nonzero exit because the contract and dispatcher do not exist.

- [x] **Step 2: Implement quick-create without nested forms**

Use a sibling dialog/client action boundary, not a `<form>` nested inside a transaction form. Reuse all required current master fields: customer group/area/route/credit settings for Customer; supplier code/name/contact/tax/address fields for Supplier; active category, stock/purchase unit, conversion, and existing finished-good packaging metadata for item kinds. Supply authorized reference options from the parent page; do not fetch secrets or Prisma models from the browser.

On success, append the returned option if absent, select it, close the dialog, clear only the quick-create inputs, and preserve every parent scalar and line value. On validation error, retain quick-create inputs and announce the server message. Cancel/Escape closes without calling the action.

- [x] **Step 3: Wire the five launchers where useful**

Add `[+] Supplier` beside supplier selection in purchase orders, `[+] Customer` beside customer selection in sales orders/payments, `[+] Product` beside saleable-product selection in sales orders, and `[+] Material` / `[+] Packaging` beside the corresponding recipe catalog selectors. Do not add quick-create to GRN or invoice source selectors because those must select an existing approved PO/dispatch lineage. Omit a launcher when the user lacks the corresponding manage permission or when a posted/status-locked record is displayed.

- [x] **Step 4: Verify quick-create behavior**

Extend `e2e/data-entry-ux.spec.ts` to enter parent header and line data, quick-create one party and one item type, assert the original values remain, assert the new option is selected, then Cancel the parent and assert no transaction draft was created. Add an invalid quick-create case and a rapid duplicate-submit case.

Run:

```powershell
corepack pnpm exec vitest run src/server/quick-create/quick-create-dispatch.test.ts
corepack pnpm test:e2e
git diff --check
```

Expected: focused and browser tests pass; no direct browser-to-database call, nested form, permission bypass, or duplicate master is observed.

---

### Task 3: Reconcile navigation and add receivables/payables read models

**Files:**

- Modify: `src/config/navigation.ts`
- Modify: `src/config/navigation.test.ts`
- Create: `src/modules/accounting/application/subledger-workbench-contracts.ts`
- Create: `src/server/accounting/prisma-subledger-workbench.ts`
- Create: `src/server/accounting/subledger-workbench.test.ts`
- Test: `src/config/navigation.test.ts`
- Test: `src/server/accounting/subledger-workbench.test.ts`
- Integration test: `src/test/subledger-workbench.integration.test.ts`

**Interfaces:**

- Produces navigation routes for `production.materialIssues`, `production.packagingConsumption`, `accounting.receivables`, and `accounting.payables` as active permission-filtered children; removes `accounting.journalVouchers` and its child.
- Produces `SubledgerWorkbenchQuery = { asOf: Date; query: string; page: number }`.
- Produces `ReceivablePartySummary`, `PayablePartySummary`, `ReceivablePartyDetail`, and `PayablePartyDetail` with decimal-string totals, aging buckets, and typed linked history rows.
- Produces `PrismaSubledgerWorkbench.listReceivables(query)`, `.getReceivable(customerId, asOf)`, `.listPayables(query)`, and `.getPayable(supplierId, asOf)`.

- [ ] **Step 1: Add failing navigation and exact-calculation tests**

Navigation assertions:

- the four approved entries are active and retain existing view permissions;
- Journal Vouchers is absent and Manual Journals remains active;
- Purchase Invoices/Administration Settings remain planned;
- Reprocess/Waste & Damage remain planned and are not mapped to a working route.

Read-model assertions use repository test doubles and exact decimal strings:

- receivable list/detail includes posted invoices, effective completed return credits, posted payments, reversals, and effective allocations as of the date;
- payable list/detail includes authoritative positive source entries, posted payments, reversals, advances, and effective allocations;
- aging uses current/1–30/31–60/61–90/90+ buckets without floating-point arithmetic;
- outstanding and credits/advances are presented separately so net credit cannot become a negative editable balance;
- draft/cancelled/future events and reversed allocations are excluded according to existing effective-event helpers;
- pagination/search are stable and details return `null` for an unknown party.

Run: `corepack pnpm exec vitest run src/config/navigation.test.ts src/server/accounting/subledger-workbench.test.ts`
Expected: nonzero exit on the still-planned navigation and missing workbench interfaces.

- [ ] **Step 2: Implement purpose-built read-only contracts**

Use existing `customerInvoiceSettlement`, effective customer-payment rules, `supplierOpenItems`, `supplierStatement`, and effective supplier-payment allocation rules rather than duplicating financial formulas. Query bounded pages and their associated histories without one query per displayed row. Return presentation contracts only; never expose Prisma objects or accept balance values from clients.

- [ ] **Step 3: Add live reconciliation coverage**

In `src/test/subledger-workbench.integration.test.ts`, use the Phase 27 fixture and assert:

- customer/supplier detail totals reconcile to their authoritative ledger signed sums as of the fixture date;
- receivable/payable aging totals reconcile to the established financial-report results;
- reversal and allocation history does not count economically ineffective allocations;
- calling every workbench method creates no ledger, journal, payment, invoice, receipt, or audit row.

Run: `corepack pnpm test:integration`
Expected before implementation: the new integration file fails to compile/import; after implementation all integration tests pass and the concurrent-query warning remains absent.

- [ ] **Step 4: Verify the task**

Run:

```powershell
corepack pnpm exec vitest run src/config/navigation.test.ts src/server/accounting/subledger-workbench.test.ts
corepack pnpm test:integration
git diff --check
```

Expected: navigation and exact read-model tests pass; live workbench queries reconcile and are read-only.

---

### Task 4: Build Receivables and Payables list/detail/payment UX

**Files:**

- Create: `src/components/accounting/subledger-workbench.tsx`
- Create: `src/app/(erp)/accounting/receivables/page.tsx`
- Create: `src/app/(erp)/accounting/receivables/[customerId]/page.tsx`
- Create: `src/app/(erp)/accounting/payables/page.tsx`
- Create: `src/app/(erp)/accounting/payables/[supplierId]/page.tsx`
- Create: `src/app/(erp)/purchasing/supplier-payments/new/page.tsx`
- Modify: `src/app/(erp)/purchasing/supplier-payments/page.tsx`
- Modify: `src/components/accounting/phase23-forms.tsx`
- Modify: `src/app/(erp)/accounting/page.tsx`
- Modify: `src/app/(erp)/sales/payments/new/page.tsx`
- Browser test: `e2e/data-entry-ux.spec.ts`
- Runtime test: `e2e/runtime-stability.spec.ts`

**Interfaces:**

- Consumes: `PrismaSubledgerWorkbench` from Task 3 and existing customer/supplier payment actions.
- Produces: server-rendered list/detail routes with `asOf`, search, paging, history links, empty state, aging summary, and permission-aware primary action.
- Produces: supplier-payment create route accepting `searchParams.supplier`; customer payment continues to accept `searchParams.customer`.

- [ ] **Step 1: Add failing browser route/action tests**

Assert an authorized accounting viewer can navigate from the sidebar to both lists and details; a manager sees `+ New Customer Payment` / `+ New Supplier Payment`; a viewer does not. Assert the customer/supplier is preselected on the payment form, Cancel returns to the originating workbench when a validated internal `returnTo` is supplied, and no manual Create Receivable/Create Payable or balance input exists.

Run: `corepack pnpm test:e2e`
Expected: nonzero exit because routes/actions are absent.

- [ ] **Step 2: Implement lists and details**

Render customer/supplier identity, signed ledger balance, gross outstanding, credit/advance, overdue amount, oldest open date, five aging bands, and chronological linked history. Link invoices, returns, customer payments, supplier payments, and supported purchasing sources to existing detail routes. Unsupported source types render immutable number/date/type text rather than a broken link.

Use `PageActions`, `SearchableSelect` or query input, `EmptyState`, responsive table containment, and the existing server guard. Parse `asOf`, `page`, and query on the server; invalid values fall back to today/page 1/empty query.

- [ ] **Step 3: Refactor supplier payment creation into a first-class page**

Move the existing inline `SupplierPaymentForm` from the list into `/purchasing/supplier-payments/new`, add the clear list-page action, support supplier preselection, and add Save draft/Cancel using the shared primitives. Do not change `saveSupplierPayment`, posting, allocation, reversal, or treasury validation.

- [ ] **Step 4: Verify the task**

Run:

```powershell
corepack pnpm test:e2e
corepack pnpm test:integration
git diff --check
```

Expected: workbench navigation/list/detail/payment tests pass; runtime observation is clean; integration totals remain reconciled.

---

### Task 5: Add first-class Material Issues and Packaging Consumption workbenches

**Files:**

- Create: `src/modules/production/application/transaction-workbench-contracts.ts`
- Create: `src/modules/production/application/transaction-workbench-routing.ts`
- Create: `src/modules/production/application/transaction-workbench-routing.test.ts`
- Create: `src/server/production/prisma-production-transaction-workbench.ts`
- Create: `src/server/production/production-transaction-workbench.test.ts`
- Create: `src/app/(erp)/production/material-actions.ts`
- Create: `src/app/(erp)/production/packaging-actions.ts`
- Create: `src/app/(erp)/production/material-issues/page.tsx`
- Create: `src/app/(erp)/production/material-issues/new/page.tsx`
- Create: `src/app/(erp)/production/material-issues/[transactionId]/page.tsx`
- Create: `src/app/(erp)/production/material-issues/[transactionId]/edit/page.tsx`
- Create: `src/app/(erp)/production/packaging-consumption/page.tsx`
- Create: `src/app/(erp)/production/packaging-consumption/new/page.tsx`
- Create: `src/app/(erp)/production/packaging-consumption/[transactionId]/page.tsx`
- Create: `src/app/(erp)/production/packaging-consumption/[transactionId]/edit/page.tsx`
- Modify: `src/app/(erp)/production/batches/[id]/materials/actions.ts`
- Modify: `src/app/(erp)/production/batches/[id]/packaging/actions.ts`
- Modify: `src/app/(erp)/production/batches/[id]/materials/page.tsx`
- Modify: `src/app/(erp)/production/batches/[id]/packaging/page.tsx`
- Modify: `src/components/production/material-transaction-form.tsx`
- Modify: `src/components/production/packaging-transaction-form.tsx`
- Test: `src/server/production/production-transaction-workbench.test.ts`
- Browser test: `e2e/data-entry-ux.spec.ts`

**Interfaces:**

- Produces: `ProductionTransactionQuery = { query: string; type?: string; status?: string; page: number }` and paged material/packaging summary records.
- Produces: eligible-batch options containing batch id/number, status, finished good, and relevant warehouse.
- Consumes unchanged `ProductionMaterialRepository` / `ProductionPackagingRepository` mutation methods and existing transaction records/views.
- Produces shared server actions that accept a closed internal `returnContext` enum (`batch` or `workbench`) rather than an arbitrary redirect URL; successful save/post/cancel revalidates both route families and redirects only to an allowed route.
- Produces `productionTransactionReturnPath(kind, context, batchId, transactionId?)` in `transaction-workbench-routing.ts`; it accepts only typed material/packaging kinds and batch/workbench contexts and never consumes a caller-supplied URL.

- [ ] **Step 1: Add failing adapter/action tests**

Assert:

- list search/status/type/pagination returns existing transactions without mutating them;
- eligible material batches are RELEASED/IN_PROGRESS as permitted by the existing material engine, and packaging batches satisfy the existing packaging state rules;
- details use `getTransaction`; create data uses the existing `getBatchMaterialView` / `getBatchPackagingView` plus existing unit/warehouse methods;
- shared actions call the existing application use case exactly once and choose only batch/workbench return paths;
- forged return contexts, invalid batch ids, and ineligible status still fail through existing validation rather than redirecting or posting.

Run: `corepack pnpm exec vitest run src/server/production/production-transaction-workbench.test.ts src/modules/production/application/transaction-workbench-routing.test.ts`
Expected: nonzero exit because the workbench read adapter/shared action routing contract is absent.

- [ ] **Step 2: Centralize route adapters without duplicating engines**

Move only server-action orchestration/revalidation from the nested route files into the shared material/packaging action modules; retain the nested action modules as thin re-exports only if Next.js requires route-local action imports. Do not copy transaction preparation, stock validation, posting, costing, or audit logic.

- [ ] **Step 3: Implement list/create/detail/edit routes**

Lists expose search, type/status filters, transaction/batch/product/date/status columns, detail links, and `+ New Material Issue` / `+ New Packaging Transaction`. New routes first select an eligible batch and then render the existing form against that batch view. Detail shows immutable provenance and lifecycle actions; edit is available only for DRAFT. Existing batch pages link to the first-class detail while remaining fully usable.

Material list wording covers ISSUE/RETURN/CONSUMPTION even though the sidebar label is Material Issues. Packaging list covers ISSUE/RETURN/CONSUMPTION/DAMAGE. Do not expose Reprocess or Waste & Damage as complete engines.

- [ ] **Step 4: Verify the task**

Extend Playwright for sidebar → list → new batch selection → invalid validation → Cancel and seeded detail/edit navigation. Run:

```powershell
corepack pnpm exec vitest run src/server/production/production-transaction-workbench.test.ts src/modules/production/application/transaction-workbench-routing.test.ts
corepack pnpm test:integration
corepack pnpm test:e2e
git diff --check
```

Expected: workbench tests pass and existing material/packaging inventory/costing effects remain unchanged in the golden integration workflow.

---

### Task 6: Standardize master-data, purchasing, GRN/QC, and inventory entry

**Files:**

- Modify: `src/components/master-data/unit-form.tsx`
- Modify: `src/components/master-data/category-form.tsx`
- Modify: `src/components/master-data/item-form.tsx`
- Modify: `src/components/master-data/item-master-page.tsx`
- Modify: `src/components/inventory/warehouse-form.tsx`
- Modify: `src/components/inventory/inventory-posting-form.tsx`
- Modify: `src/components/costing/valuation-actions.tsx`
- Modify: `src/components/purchasing/supplier-form.tsx`
- Modify: `src/components/purchasing/purchase-order-form.tsx`
- Modify: `src/components/purchasing/goods-receipt-form.tsx`
- Modify: `src/components/purchasing/goods-receipt-qc-form.tsx`
- Modify: `src/components/purchasing/purchase-return-form.tsx`
- Modify: `src/components/purchasing/purchased-material-quarantine-form.tsx`
- Modify: `src/app/(erp)/inventory/units/page.tsx`
- Modify: `src/app/(erp)/inventory/categories/page.tsx`
- Modify: `src/app/(erp)/inventory/raw-materials/page.tsx`
- Modify: `src/app/(erp)/inventory/packaging-materials/page.tsx`
- Modify: `src/app/(erp)/inventory/finished-goods/page.tsx`
- Modify: `src/app/(erp)/inventory/warehouses/page.tsx`
- Modify: `src/app/(erp)/inventory/stock-adjustments/page.tsx`
- Modify: `src/app/(erp)/inventory/valuation/page.tsx`
- Modify: `src/app/(erp)/purchasing/suppliers/page.tsx`
- Modify: `src/app/(erp)/purchasing/purchase-orders/page.tsx`
- Modify: `src/app/(erp)/purchasing/purchase-orders/new/page.tsx`
- Modify: `src/app/(erp)/purchasing/purchase-orders/[id]/edit/page.tsx`
- Modify: `src/app/(erp)/purchasing/goods-receiving/page.tsx`
- Modify: `src/app/(erp)/purchasing/goods-receiving/new/page.tsx`
- Modify: `src/app/(erp)/purchasing/goods-receiving/[id]/edit/page.tsx`
- Modify: `src/app/(erp)/purchasing/goods-receiving/[id]/qc/page.tsx`
- Modify: `src/app/(erp)/purchasing/purchase-returns/page.tsx`
- Modify: `src/app/(erp)/purchasing/purchase-returns/new/page.tsx`
- Modify: `src/app/(erp)/purchasing/purchase-returns/[id]/edit/page.tsx`
- Modify: `src/app/(erp)/purchasing/purchase-returns/quarantine/page.tsx`
- Create: `src/components/ui/data-entry-adoption.test.ts`
- Browser test: `e2e/data-entry-ux.spec.ts`

**Interfaces:**

- Consumes Task 1 primitives and Task 2 quick-create launchers.
- Preserves all current action signatures and application validation.
- Produces consistent list action, Save/Cancel, Add Line/Remove, searchable long-reference selection, feedback, pending, and single-flight behavior.

- [ ] **Step 1: Add a failing static adoption contract**

Create a focused source-contract test that enumerates the exact form files above and asserts each applicable form imports/uses `FormActions` and `ActionFeedback`; multi-line forms use `LineEditorControls`; long party/item/warehouse/lot selectors use `SearchableSelect`; and old ad hoc submit-only button strings are absent only where replaced. Keep the assertions explicit per form so an inapplicable primitive is not forced onto a fixed enum/status action.

Run: `corepack pnpm exec vitest run src/components/ui/data-entry-adoption.test.ts`
Expected: nonzero exit naming the first unadopted form.

- [ ] **Step 2: Adopt primitives without changing payloads**

Preserve every `name`, serialized line index, hidden id, server action, and lifecycle condition. Add clear list `+ New`/`+ Add` actions, Save draft/Save labels, non-submit Cancel destinations, pending labels, announced errors, and single-flight guards. For purchase orders, GRNs, and returns, preserve row state when adding/removing, keep stable client keys, reindex only submitted field names, and prevent removal below the domain's minimum line count.

- [ ] **Step 3: Verify representative user flows**

Extend Playwright with master add/cancel/validation, purchase-order multi-line add/remove/save, GRN line editing and QC validation, inventory adjustment/transfer pending behavior, searchable supplier/item/warehouse/lot selection, and rapid duplicate submission. Assert one draft/movement only where a valid mutation is deliberately submitted to the disposable E2E database.

- [ ] **Step 4: Run affected coverage**

Run:

```powershell
corepack pnpm exec vitest run src/components/ui/data-entry-adoption.test.ts
corepack pnpm exec vitest run src/server/purchasing/purchasing-fulfilment.test.ts src/server/inventory/transactional-inventory-posting.test.ts
corepack pnpm test:integration
corepack pnpm test:e2e
git diff --check
```

Expected: source contract, purchasing/inventory invariants, integration, and browser flows pass without payload or accounting changes.

---

### Task 7: Standardize production, sales, invoices, returns, and payments entry

**Files:**

- Modify: `src/components/production/recipe-form.tsx`
- Modify: `src/components/production/batch-form.tsx`
- Modify: `src/components/production/material-transaction-form.tsx`
- Modify: `src/components/production/packaging-transaction-form.tsx`
- Modify: `src/components/production/output-transaction-form.tsx`
- Modify: `src/components/costing/production-cost-actions.tsx`
- Modify: `src/components/sales/customer-form.tsx`
- Modify: `src/components/sales/sales-master-form.tsx`
- Modify: `src/components/sales/salesperson-form.tsx`
- Modify: `src/components/sales/sales-order-form.tsx`
- Modify: `src/components/sales/sales-dispatch-form.tsx`
- Modify: `src/components/sales/sales-invoice-form.tsx`
- Modify: `src/components/sales/sales-return-form.tsx`
- Modify: `src/components/sales/sales-return-inspection-form.tsx`
- Modify: `src/components/sales/customer-payment-form.tsx`
- Modify: `src/components/sales/customer-credit-allocation-form.tsx`
- Modify: `src/app/(erp)/production/recipes/page.tsx`
- Modify: `src/app/(erp)/production/recipes/new/page.tsx`
- Modify: `src/app/(erp)/production/recipes/[id]/edit/page.tsx`
- Modify: `src/app/(erp)/production/batches/page.tsx`
- Modify: `src/app/(erp)/production/batches/new/page.tsx`
- Modify: `src/app/(erp)/production/batches/[id]/edit/page.tsx`
- Modify: `src/app/(erp)/production/batches/[id]/materials/page.tsx`
- Modify: `src/app/(erp)/production/batches/[id]/packaging/page.tsx`
- Modify: `src/app/(erp)/production/batches/[id]/output/page.tsx`
- Modify: `src/app/(erp)/production/batches/[id]/costing/page.tsx`
- Modify: `src/app/(erp)/sales/customers/page.tsx`
- Modify: `src/app/(erp)/sales/customer-groups/page.tsx`
- Modify: `src/app/(erp)/sales/areas/page.tsx`
- Modify: `src/app/(erp)/sales/routes/page.tsx`
- Modify: `src/app/(erp)/sales/salespersons/page.tsx`
- Modify: `src/app/(erp)/sales/orders/page.tsx`
- Modify: `src/app/(erp)/sales/orders/new/page.tsx`
- Modify: `src/app/(erp)/sales/orders/[id]/edit/page.tsx`
- Modify: `src/app/(erp)/sales/dispatches/page.tsx`
- Modify: `src/app/(erp)/sales/dispatches/new/page.tsx`
- Modify: `src/app/(erp)/sales/dispatches/[id]/edit/page.tsx`
- Modify: `src/app/(erp)/sales/invoices/page.tsx`
- Modify: `src/app/(erp)/sales/invoices/new/page.tsx`
- Modify: `src/app/(erp)/sales/invoices/[id]/edit/page.tsx`
- Modify: `src/app/(erp)/sales/returns/page.tsx`
- Modify: `src/app/(erp)/sales/returns/new/page.tsx`
- Modify: `src/app/(erp)/sales/returns/[id]/inspection/page.tsx`
- Modify: `src/app/(erp)/sales/payments/page.tsx`
- Modify: `src/app/(erp)/sales/payments/new/page.tsx`
- Modify: `src/app/(erp)/sales/payments/[id]/edit/page.tsx`
- Modify: `src/components/ui/data-entry-adoption.test.ts`
- Browser test: `e2e/data-entry-ux.spec.ts`

**Interfaces:**

- Consumes Task 1 primitives and Task 2 quick-create.
- Preserves exact existing production/sales form payloads, eligibility data, state machines, and server actions.
- Produces consistent multi-line and party/item selection behavior across the listed forms.

- [ ] **Step 1: Extend the failing adoption contract**

Add explicit applicability assertions per form: recipe ingredient/packaging rows, dispatch allocations, invoice lines, return lines, and inspection rows use stable Add/Remove/Edit controls where their draft state permits; material/packaging/output single-transaction forms use Save/Cancel but do not pretend to be multi-line; customer/payment selectors are searchable and quick-create-enabled only where approved.

Run: `corepack pnpm exec vitest run src/components/ui/data-entry-adoption.test.ts`
Expected: nonzero exit listing unadopted production/sales forms.

- [ ] **Step 2: Adopt primitives and preserve lifecycle boundaries**

Keep posted/completed records immutable. Draft create/edit forms get Save/Cancel, stable line editing, searchable long selectors, clear errors, pending labels, and single-flight dispatch. Post/approve/deliver/inspect/complete/reverse/cancel-document actions remain separate safety actions with existing reasons and status checks; do not relabel them Save.

- [ ] **Step 3: Verify representative user flows**

Extend Playwright for recipe ingredient/packaging line entry, batch create Cancel, material/packaging workbench save, sales-order lines, dispatch lot selection, invoice lines, return/inspection lines, customer-payment allocation, quick-created customer/item selection, validation retention, and duplicate-submit prevention.

- [ ] **Step 4: Run affected coverage**

Run:

```powershell
corepack pnpm exec vitest run src/components/ui/data-entry-adoption.test.ts
corepack pnpm exec vitest run src/modules/production/domain/production-integrity.test.ts src/server/sales/payment-integrity.test.ts src/modules/accounting/domain/reversal-integrity.test.ts
corepack pnpm test:integration
corepack pnpm test:e2e
git diff --check
```

Expected: UX tests pass and production custody/costing, sales settlement, reversal, and audit behavior remain unchanged.

---

### Task 8: Standardize accounting and administration entry

**Files:**

- Modify: `src/components/accounting/accounting-management-forms.tsx`
- Modify: `src/components/accounting/phase23-forms.tsx`
- Modify: `src/components/access/user-create-form.tsx`
- Modify: `src/components/access/user-role-form.tsx`
- Modify: `src/components/access/user-password-reset-form.tsx`
- Modify: `src/components/access/role-permission-form.tsx`
- Modify: `src/app/(erp)/accounting/chart-of-accounts/page.tsx`
- Modify: `src/app/(erp)/accounting/manual-journals/page.tsx`
- Modify: `src/app/(erp)/accounting/settings/page.tsx`
- Modify: `src/app/(erp)/accounting/cash-bank-accounts/page.tsx`
- Modify: `src/app/(erp)/accounting/transfers/page.tsx`
- Modify: `src/app/(erp)/accounting/expenses/page.tsx`
- Modify: `src/app/(erp)/purchasing/supplier-payments/page.tsx`
- Modify: `src/app/(erp)/purchasing/supplier-payments/new/page.tsx`
- Modify: `src/app/(erp)/administration/users/page.tsx`
- Modify: `src/app/(erp)/administration/roles-permissions/page.tsx`
- Modify: `src/components/ui/data-entry-adoption.test.ts`
- Browser test: `e2e/data-entry-ux.spec.ts`

**Interfaces:**

- Consumes Task 1 primitives.
- Preserves existing accounting/access server action signatures, protected-role safeguards, closed-period checks, balance rules, and reversal reasons.
- Produces consistent Save/Cancel/Add Line/search/feedback/pending/single-flight behavior where applicable.

- [ ] **Step 1: Extend the failing adoption contract**

Assert manual journals and expenses expose Add Line/Remove before posting, treasury/account/settings/user/role forms expose Save/Cancel and feedback, long account/treasury/supplier/role selectors are searchable, and status/reversal/password actions have pending plus single-flight protection without inappropriate Cancel navigation.

Run: `corepack pnpm exec vitest run src/components/ui/data-entry-adoption.test.ts`
Expected: nonzero exit identifying unadopted accounting/access forms.

- [ ] **Step 2: Adopt primitives without changing authority**

Preserve balanced-journal validation, mapping/period controls, treasury source facts, supplier allocation rules, least privilege, last-SUPER_ADMIN protection, and non-secret password handling. Do not add editable receivable/payable balances or manual subledger events.

- [ ] **Step 3: Verify representative user flows**

Extend Playwright for manual-journal/expense Add Line and validation, supplier-payment Save/Cancel, accounting select search, user creation validation, roles/permissions Save, and duplicate-submit prevention. Reuse runtime observation on every exercised route.

- [ ] **Step 4: Run affected coverage**

Run:

```powershell
corepack pnpm exec vitest run src/components/ui/data-entry-adoption.test.ts src/server/accounting/accounting-integrity.test.ts src/modules/access/domain/authorization.test.ts
corepack pnpm test:integration
corepack pnpm test:e2e
git diff --check
```

Expected: accounting/access invariants and browser UX pass with no permission, audit, or financial regression.

---

### Task 9: Reconcile inventory/docs and close the Data Entry UX gate

**Files:**

- Modify: `docs/testing/workflow-inventory.md`
- Modify: `docs/testing/runtime-action-audit.md`
- Modify: `docs/testing/e2e-test-strategy.md`
- Modify: `docs/engineering/testing.md`
- Modify: `docs/phases/current.md`
- Modify: `progress.md`
- Modify: `e2e/runtime-stability.spec.ts`
- Modify: `e2e/navigation.spec.ts`
- Modify: `e2e/mobile/shell.spec.ts`
- Test: all focused files introduced or changed by Tasks 1–8

**Interfaces:**

- Consumes all implemented routes, primitives, focused test evidence, integration evidence, and E2E evidence.
- Produces an explicit `DATA ENTRY UX: READY` or `NOT READY` result and updated inventory counts without starting another subproject.

- [x] **Step 1: Run the complete focused regression set**

Run all focused commands recorded by Tasks 1–8 in one Vitest invocation, then rerun the accounting, inventory, production, purchasing, sales, access, and runtime config tests affected by the diff. Expected: every required focused test passes; no test is silently replaced by a static source assertion when real browser behavior is required.

- [x] **Step 2: Extend final navigation/runtime/mobile E2E**

Ensure navigation coverage visits all four new workbenches and no Journal Vouchers link; runtime coverage includes seeded accounting and production workbench details; mobile coverage proves a searchable select, multi-line form, quick-create dialog, Save/Cancel, and safety action remain reachable without horizontal form overflow.

- [x] **Step 3: Run final gates in the required order**

Stop only the canonical `HamdFoodsERP` scheduled task for the established port-clear build maintenance window, verify port 3100 is clear, then run:

```powershell
corepack pnpm test
corepack pnpm verify
corepack pnpm test:integration
corepack pnpm test:e2e
git diff --check
```

Expected: all commands exit 0; Vitest reports exact pass/skip counts; Next production build completes; traced integration contains no concurrent `client.query()` warning; Playwright has zero unexpected Node/server/browser errors, same-origin request failures, or 5xx responses; the conditional installer test may remain explicitly infrastructure-gated.

Restart the same canonical task, require its sole listener on `127.0.0.1:3100`, and require `corepack pnpm production:health` to pass. A task-output lock is resolved only through this maintenance sequence, never by deleting a live `.next/standalone` tree.

- [x] **Step 4: Reconcile durable evidence**

Update the workflow inventory only from proven behavior:

- Receivables and Payables move to `COMPLETE`.
- Material Issues and Packaging Consumption stay `COMPLETE` and become active first-class routes.
- Journal Vouchers is removed as a duplicate.
- Reprocess and Waste & Damage stay `PARTIAL`.
- Purchase Invoices and Administration Settings stay `MISSING`.
- Remaining planned labels equal four.

Record corrected navigation items, workbenches completed, every data-entry screen family improved, remaining partial/missing workflows, remaining planned labels, exact unit/integration/E2E counts, build result, warning/error status, production health, and `git diff --check` in `docs/phases/current.md` and `progress.md`.

- [x] **Step 5: Self-review scope and report readiness**

Read every changed file. Confirm no second material/packaging posting engine, subledger mutation, editable balance, purchase-invoice/reprocess/waste/settings engine, navigation misclassification, secret exposure, unrelated refactor, Phase 33 work, commit, or push entered the diff. Report `DATA ENTRY UX: READY` only if all required behaviors and final gates pass; otherwise report `NOT READY` with exact blockers.

**Closure result (2026-09-12): DATA ENTRY UX: READY.** Tasks 1–9 are complete. Final evidence is 265 unit tests passed / 2 skipped, 15 integration tests passed / 1 documented infrastructure-gated skip, 26/26 E2E with zero retries and clean browser/server logs, an 85-page production build, healthy loopback-only production, and an inventory of 55 `COMPLETE`, 0 `BACKEND EXISTS / UI INCOMPLETE`, 2 `PARTIAL`, and 2 `MISSING` workflows across 58 sidebar entries with 4 planned labels. Phase 33 remains unstarted.

## Unresolved Product Decisions

None. The approved specification fixes navigation destinations, workbench authority, quick-create behavior, single-flight scope, adoption boundaries, remaining classifications, and final gates. Any newly discovered requirement that changes those visible contracts must return to specification review before implementation.
