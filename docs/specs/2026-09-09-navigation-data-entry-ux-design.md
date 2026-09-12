# Navigation Reconciliation and Data Entry UX Design

**Status:** Approved for implementation planning
**Date:** 2026-09-09
**Boundary:** Pre-Phase-33 usability work over existing engines only

## Goal

Make every existing workflow easy to find and make routine ERP entry consistent, searchable, resilient to mistakes, and explicit about save/post boundaries. Reuse current server-authoritative application and repository contracts. Do not create new transaction authority, editable balances, the two missing engines, or Phase 33 scope.

## Visual direction

This is a preservation-oriented ERP usability pass for factory operators, supervisors, finance staff, and administrators working quickly with consequential records. Keep the existing sober operational shell, real content, and responsive behavior. Do not introduce marketing imagery, decorative dashboards, a new typeface dependency, broad motion, or a visual rebrand.

### Tokens and roles

- Surface `#f3f5f3`, raised panels `#ffffff`, primary ink `#18211b` (15.07:1 on surface), and muted ink `#56635b` (5.75:1 on surface) remain unchanged.
- Accent `#176b45` remains the infrequent primary-action/link color (6.51:1 with white text). Focus `#168054` remains the two-pixel keyboard outline (4.94:1 on white).
- Existing structural border `#d4dbd6` remains for nonessential grouping. Add control-border `#89968e` only where an input/select boundary is required for perception; it is 3.08:1 on the white control ground.
- Sidebar `#13231a`, sidebar ink `#eef3ef` (14.58:1), muted sidebar ink `#a8b8ad` (7.89:1), and sidebar focus `#60d29a` (8.72:1) remain unchanged.
- Arial/Helvetica remains the dependency-free type family. Page titles stay 24–30px bold at approximately 1.2 line height; body and controls stay 14–16px with 1.5 line height; tabular financial/quantity values retain tabular numerals. No decorative display face is added.
- Spacing uses the existing Tailwind 4px scale: 8px within a compact control cluster, 12px between related fields/actions, 16–20px within cards, and 20–28px between page blocks. The parent card owns internal padding; the page container owns block spacing.
- Controls retain 8px corners, cards retain 12px corners, and no new elevation is added. Focus, border, status color, and text—not shadow—communicate state.

### Layout and interaction

The composition remains a left control spine plus a wide operational canvas. At desktop widths the page header owns the primary `+ New`/`+ Add` action, filters follow, then summary or line-entry content, feedback, and a bottom Save/Cancel action row. At phone widths the existing drawer replaces the spine, header actions become full-width below the description, fields become one column, tables remain in deliberate horizontal containers, and the Save/Cancel row remains in normal flow with 44px controls.

```text
desktop ≥1280                         mobile 375
┌──────────┬──────────────────────┐   ┌──────────────────┐
│ dark ERP │ title / authority [+]│   │ title / authority│
│ control  ├──────────────────────┤   │ [+ New]           │
│ spine    │ filters / summary    │   ├──────────────────┤
│          ├──────────────────────┤   │ search / fields   │
│          │ lines or history     │   ├──────────────────┤
│          ├──────────────────────┤   │ lines / history → │
│          │ feedback  Save Cancel│   ├──────────────────┤
└──────────┴──────────────────────┘   │ feedback          │
                                     │ Save        Cancel │
                                     └──────────────────┘
```

The existing dark forest sidebar/`HF` mark is the sole visual signature. It identifies the operational product at every width through the desktop spine or mobile drawer; data-entry additions remain subordinate. Motion is limited to existing navigation width transitions and immediate focus/pending feedback, with the existing reduced-motion rule retained.

### Direction critique

- Subject substitution: a generic retail admin could use the form grid, but not the combination of factory batch custody, exact ledger status, and the persistent Hamd Foods control spine. The workbench geometry is therefore driven by traceable operational history rather than generic card decoration.
- Default clusters rejected: no bento grid, centered hero, gradient SaaS surface, decorative step numbers, or dark content canvas. Summary bands exist only where aging/custody totals determine the next action.
- Free axes: palette/type/shape are preservation constraints; layout follows high-density ERP entry; motion is limited by consequential actions and reduced-motion support; imagery is explicitly omitted because no supplied asset aids data entry.
- Concentration: removing the sidebar/brand spine removes product identity; removing any individual form card removes detail only. No second decorative signature is introduced.
- Arithmetic: all declared text contrasts pass 4.5:1; the new white-ground control border passes 3:1; 44px mobile targets and the 375/1280 layouts match the existing breakpoints and container widths.

## Tried

- A full visual redesign was rejected because it would obscure behavior changes and risk the established mobile/PWA shell.
- Per-page styling was rejected because it would preserve inconsistent labels and interaction states.
- A wizard/card-heavy entry pattern was rejected because these workflows require dense comparison, editable lines, and visible source provenance.

## Selected approach

Use an incremental shared-primitive approach:

1. Correct navigation and add thin first-class workbenches over existing read/write engines.
2. Establish a small accessible form toolkit for actions, searchable selection, line editing, feedback, pending state, and client-side single-flight submission.
3. Add in-context quick-create for existing master aggregates.
4. Adopt the toolkit across existing entry workflows in bounded domain slices without rewriting their business logic.

Alternatives rejected:

- Styling each page independently would preserve current inconsistency and duplicate behavior.
- A wholesale form-framework migration would expand risk and obscure the authoritative server-action contracts.
- New receivable, payable, material, or packaging engines would duplicate existing authority and violate the approved boundary.

## Scope decomposition

### Slice A — Navigation and first-class workbenches

Navigation changes:

- `Material Issues` becomes active at `/production/material-issues`.
- `Packaging Consumption` becomes active at `/production/packaging-consumption`.
- `Receivables` becomes active at `/accounting/receivables`.
- `Payables` becomes active at `/accounting/payables`.
- The duplicate planned `Journal Vouchers` entry is removed. `Manual Journals` remains the single manual-journal workflow.
- `Reprocess` and `Waste & Damage` remain visibly planned/partial.
- `Purchase Invoices` and Administration `Settings` remain visibly planned/missing.

Material Issues and Packaging Consumption are routing/read-model additions over the current batch transaction engines:

- Each list shows relevant batches and existing transactions with search, status/type filters, pagination where needed, and a clear `+ New Material Issue` or `+ New Packaging Transaction` action.
- New routes require selection of an eligible batch, then render the existing transaction form with that batch's authoritative requirements, warehouses, and lot candidates.
- Detail routes render the existing immutable/draft transaction detail and lifecycle actions. Draft edit/remove and posting continue to call the existing production application/repository code.
- Existing `/production/batches/[id]/materials` and `/packaging` routes remain valid. New routes are alternate first-class access paths, not new ownership boundaries.

Receivables workbench:

- `/accounting/receivables` lists customers with derived receivable balance, unapplied credit, overdue amount, oldest due date, and aging bands as of the selected date.
- `/accounting/receivables/[customerId]` shows the customer identity, derived total/outstanding/credit, aging, and a chronological history of posted invoices, completed return credits, posted/reversed customer payments, and allocations.
- Invoice, return, and payment references link to their existing detail screens.
- `+ New Customer Payment` links to `/sales/payments/new?customer=<id>` when a customer is known, or the ordinary new-payment screen from the list.
- No receivable create/edit action or balance input exists.

Payables workbench:

- `/accounting/payables` lists suppliers with derived payable balance, supplier advance/unapplied payment, overdue amount, oldest open source date, and aging bands as of the selected date.
- `/accounting/payables/[supplierId]` shows supplier identity, derived total/outstanding/advance, aging, and chronological source-document, payment, reversal, and allocation history.
- Source and payment references link to their existing detail screens where a supported route exists.
- `+ New Supplier Payment` opens a dedicated create surface reusing the existing supplier-payment action and preselects the supplier when known.
- No payable create/edit action or balance input exists.

All workbench calculations use exact decimals and existing effective-allocation/reversal rules. Customer ledger entries and supplier payable ledger entries remain authoritative; report/UI code only derives presentation rows.

### Slice B — Shared data-entry contract

Add focused UI primitives rather than a new form framework:

- `PageActions`: consistent primary `+ New …` / `+ Add …` placement beside the page heading.
- `FormActions`: primary `Save` plus secondary `Cancel`; wording may be `Save draft` when lifecycle meaning matters. Cancel is navigation-only and never submits.
- `ActionFeedback`: accessible field summary and server error/success state using `aria-live`; messages remain non-secret.
- `PendingButton`: disables while pending, changes its visible label, exposes `aria-disabled`, and prevents repeated client dispatch.
- `SearchableSelect`: labeled accessible combobox over supplied authorized options, keyboard navigable, clearable when optional, and able to accept a newly quick-created option.
- `LineEditor`: consistent `+ Add Line` / `Add Item`, row numbering, edit-in-place before posting, and `Remove` with at least one valid row when the domain requires it.
- `QuickCreate`: in-context dialog/sheet described below.

The toolkit owns interaction and presentation only. Zod/application validation, permissions, exact calculations, eligibility, stock, lifecycle transitions, and persistence stay in existing server use cases and repositories.

Duplicate-submit protection is a client single-flight contract: the first submit synchronously locks the form action until it resolves, buttons become disabled/pending, and a second click/Enter dispatch is ignored. Existing database uniqueness, transaction, and lifecycle checks remain the authoritative backstop. This scope does not add a generic idempotency ledger or alter business document schemas.

### Slice C — Quick-create and return-to-selection

Quick-create is available only where the current principal has the corresponding manage permission and the related master is valid for that field:

- `[+] Customer`
- `[+] Supplier`
- `[+] Product` creates a `FINISHED_GOOD` item.
- `[+] Material` creates a `RAW_MATERIAL` item.
- `[+] Packaging` creates a `PACKAGING_MATERIAL` item.

The quick-create surface opens without navigating away, preserving all unsaved transaction values and lines. It uses the existing master application use case through a narrow server action that returns a sanitized `{ id, label }` option on success. The parent inserts that option into the current authorized option list and selects it immediately. Errors remain inside the quick-create surface; cancel closes it without changing the transaction. Quick-create cannot bypass required unit/category/packaging metadata, uniqueness, permission, or active-reference validation.

The implementation must avoid nested HTML forms. The quick-create control uses a sibling dialog/client action boundary while the transaction form remains the sole outer form.

### Slice D — Domain adoption

Apply the shared contract to existing active entry surfaces, preserving their lifecycle wording and rules:

- Master data: units, categories, items/products/materials/packaging, warehouses, suppliers, customers, sales masters.
- Purchasing: purchase orders, goods receipts, QC, purchase returns, quarantine, supplier payments.
- Inventory: adjustments/transfers and valuation correction/landed-cost entry.
- Production: recipes/BOM lines, batches, material transactions, packaging transactions, output, and costing actions.
- Sales: orders, dispatches, invoices, returns/inspection, customer payments and allocations.
- Accounting: treasury accounts/transfers, expenses, manual journals, periods/mappings where editable.
- Administration: users, roles/permissions, password reset, and status actions.

Adoption rules:

- List pages expose one clearly named primary add/new action when creation is authorized.
- Create/edit pages expose Save and Cancel consistently.
- Multi-line drafts expose Add Line and Remove before posting; posted records remain immutable and do not show edit/remove controls.
- Long entity selectors use `SearchableSelect`; short fixed enums may remain native selects.
- Server validation appears near the form and field-specific messages are retained where already available.
- Every mutation shows a pending label, disables conflicting controls, and uses the single-flight guard.
- Safety/lifecycle actions such as Post, Approve, Complete, Reverse, Cancel Document, and Deactivate remain visually distinct from ordinary Save and preserve current confirmation/reason requirements.

## Data and authority flow

```text
authorized page/read model
        ↓
shared entry component → existing server action → existing application use case
        ↑                                           ↓
quick-created option ← sanitized create result ← existing authoritative repository
```

Workbench reads may add purpose-built query functions, but they return presentation contracts rather than Prisma models. No browser code accesses Prisma or calculates authoritative balances. Date/as-of filtering is parsed on the server. Exact monetary values cross the presentation boundary as decimal strings.

## Permissions

- Workbench lists/details require `accounting.view`; payment actions require the existing manage permission for that payment workflow.
- Material and packaging workbenches require `production.view`; create/edit/post actions retain existing `production.manage` checks.
- Quick-create is omitted when its master-management permission is absent. The server action independently rechecks permission.
- Navigation remains filtered by the existing principal permission model.

## Error, empty, loading, and responsive states

- Lists provide explicit empty states with the permitted next action, not blank tables.
- Detail routes use the established not-found behavior without leaking identifiers.
- Search/filter results preserve filters through pagination.
- Page navigation uses the existing route loading state; client mutations show local pending state immediately.
- Tables retain responsive horizontal containment; create/edit forms collapse to one column on phone widths, with action controls remaining reachable and at least 44px high.
- Searchable selects expose label, input role, expanded state, active option, no-results text, keyboard selection, Escape close, and focus return.
- Quick-create traps focus while open, closes on explicit Cancel/Escape when safe, and returns focus to its launcher.

## Testing

Focused component/config tests:

- corrected navigation entries and absence of Journal Vouchers;
- Add/New action visibility by permission;
- add/remove/reindex behavior for multi-line entry;
- Save invokes once, Cancel does not submit, and pending state is announced;
- searchable-select keyboard/search/selection behavior;
- quick-create success inserts and selects the new option while preserving current form state;
- quick-create validation and unauthorized handling;
- duplicate clicks/Enter dispatch only one client action.

Focused server/read-model tests:

- receivable balances, aging, credits, returns, reversals, and allocation history;
- payable balances, aging, advances, reversals, source history, and effective allocations;
- workbench routes cannot write balances;
- material/packaging workbench adapters delegate to existing engines and preserve eligibility/status rules.

Integration tests:

- seeded receivable/payable detail results reconcile to authoritative ledgers and existing aging reports;
- material/packaging create/post flows still produce the established ledger/costing effects exactly once;
- quick-created masters satisfy existing foreign-key and active-reference rules when used in a transaction.

Playwright tests:

- sidebar navigation reaches all four new workbenches;
- list → new → validation → cancel and list → detail flows;
- representative purchase order, GRN, recipe, sales order/invoice/return, and payment multi-line/add flows;
- quick-create customer/supplier/item preserves entered transaction data and selects the new option;
- rapid duplicate submit creates one draft;
- desktop and phone keyboard/focus/pending/error behavior has no browser/server runtime errors.

Final gates are focused tests, `corepack pnpm verify`, `corepack pnpm test:integration`, `corepack pnpm test:e2e`, and `git diff --check` in a port-clear maintenance window for the production build. The canonical production task is restored and health-checked afterward.

## Documentation and inventory outcome

Update navigation documentation, runtime/action coverage, current phase evidence, and `docs/testing/workflow-inventory.md` only after implementation evidence exists. Expected inventory movement:

- Receivables and Payables: `BACKEND EXISTS / UI INCOMPLETE` → `COMPLETE`.
- Material Issues and Packaging Consumption: remain `COMPLETE`, with first-class active access replacing misleading planned labels.
- Journal Vouchers: duplicate planned entry removed; Manual Journals remains `COMPLETE`.
- Reprocess and Waste & Damage remain `PARTIAL`.
- Purchase Invoices and Administration Settings remain `MISSING`.

The expected remaining planned labels are four: Purchase Invoices, Reprocess, Waste & Damage, and Administration Settings.

## Non-goals

- No manual receivable/payable creation or editable balances.
- No new purchase-invoice, reprocess, waste/disposition, or general-settings engine.
- No changes to posting, valuation, inventory custody, costing, reversal, audit, or accounting authority.
- No navigation or UI claim may mark a partial/missing engine complete.
- No Phase 33 work, commit, or push.
