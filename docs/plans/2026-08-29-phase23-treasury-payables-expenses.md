# Phase 23 Treasury, Payables, and Expenses Implementation Plan

> **For agentic workers:** Execute inline in the current session. Do not delegate, create a commit, or run automated tests. Use only the permitted implementation checks.

**Goal:** Add treasury accounts, supplier payments and settlement allocations, expense vouchers, petty cash, and company fund transfers on the existing Phase 22 GL and supplier-payable ledger.

**Architecture:** PostgreSQL stores only source documents, allocations, and account configuration. Existing Phase 22 journals remain the accounting authority; supplier payment entries extend the existing supplier-payable ledger and balances are derived from POSTED records. All posting flows run inside existing Serializable transaction boundaries and invoke the central accounting writer using stable source identities.

**Tech Stack:** TypeScript, Next.js App Router, Prisma/PostgreSQL, Decimal.js, Zod, existing RBAC and Phase 22 accounting services.

## Global Constraints

- Do not redesign Phase 1–22 systems or create a second GL, supplier ledger, or editable balance fields.
- Do not use agents/subagents, delegation, orchestration, automated tests, test-suite commands, bank reconciliation, cheque clearing, refunds, financial statements, payroll, fixed assets, multi-currency, or Phase 24 work.
- Use exact decimal values, server-derived balances and allocations, OPEN accounting periods, source-idempotent journals, immutable posted documents, and existing `accounting.view`/`accounting.manage` authorization.
- Cash and petty-cash posting rejects a negative derived GL balance. Bank balances may go negative, but the derived negative position is explicitly visible; bank charges remain an Expense Voucher concern.
- Expense vouchers use entered tax-inclusive values because the current Phase 22 configuration does not provide a dedicated recoverable-expense-tax workflow.

---

### Task 1: Treasury and Phase 23 persistence

**Files:**

- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260831030000_phase23_treasury_payments_expenses/migration.sql`
- Modify: `src/server/accounting/transactional-accounting-posting.ts`

**Consumes:** Phase 22 `AccountingAccount`, `AccountingJournal`, `SupplierPayableLedgerEntry`, and user/supplier relations.
**Produces:** Treasury account, supplier payment/allocation, expense voucher/lines, fund transfer, document sequences, source enums, and an accounting-writer entry point able to post a caller-resolved treasury GL account.

- [ ] Add exact-decimal relational models, lifecycle enums, stable uniqueness, indexes, foreign keys, and PostgreSQL triggers that prevent POSTED document mutation/deletion.
- [ ] Link every treasury account to one active posting-enabled ASSET GL account; retain historical relationships after account deactivation.
- [ ] Extend the existing supplier-payable ledger with the `SUPPLIER_PAYMENT` entry type and retain its positive-payable/negative-relief sign convention.
- [ ] Add central posting functions for supplier payments, expense vouchers, transfers, and expense reversals. Each validates exact balanced lines, checks an OPEN period through the existing journal writer, and remains source-idempotent.

### Task 2: Supplier-payment lifecycle and payable settlement

**Files:**

- Create: `src/modules/accounting/application/supplier-payment-contracts.ts`
- Create: `src/modules/accounting/application/manage-supplier-payments.ts`
- Create: `src/server/accounting/prisma-supplier-payment-repository.ts`
- Create: `src/app/(erp)/purchasing/supplier-payments/**`
- Create: `src/components/accounting/supplier-payment-*.tsx`

**Consumes:** active suppliers, Phase 22 supplier-payable ledger entries, treasury accounts, and central accounting posting.
**Produces:** DRAFT/POSTED/CANCELLED supplier payments, server-generated `SPAY-{year}-{sequence}` numbers, allocation-only settlement actions, supplier statements and aging read models.

- [ ] Require an active supplier and treasury account, a positive exact payment total, matching-supplier open items, no duplicate source allocation, and allocations no greater than both the payment remainder and payable-item remainder.
- [ ] On POSTED, atomically add exactly one negative supplier-payable entry, post `Dr AP / Cr selected treasury GL` for the full payment, then mark the payment posted. Allocations never add a second journal.
- [ ] Preserve unallocated posted value as a supplier advance/debit position; later allocations consume that remaining payment value only.
- [ ] Provide manager-confirmed oldest-first allocation proposals before they are saved, date-ranged statements with derived opening/closing balances, and aging of outstanding positive payable items only.

### Task 3: Treasury account, ledger, and transfer workflows

**Files:**

- Create: `src/modules/accounting/application/treasury-contracts.ts`
- Create: `src/modules/accounting/application/manage-treasury.ts`
- Create: `src/server/accounting/prisma-treasury-repository.ts`
- Create: `src/app/(erp)/accounting/cash-bank-accounts/**`
- Create: `src/app/(erp)/accounting/transfers/**`
- Create: `src/components/accounting/treasury-*.tsx`
- Modify: `src/config/navigation.ts`, `src/app/(erp)/accounting/page.tsx`

**Consumes:** treasury configuration, POSTED GL lines, OPEN periods, and central accounting posting.
**Produces:** protected treasury master, GL-derived balances/activity, and DRAFT/POSTED/CANCELLED transfers.

- [ ] Validate treasury GL links and account status entirely server-side; block deactivation when it would invalidate a new transaction while preserving old documents.
- [ ] Derive balance and running ledger exclusively from POSTED GL lines using asset `debit - credit`, with no treasury balance table.
- [ ] Post transfers atomically as `Dr destination / Cr source`; require distinct active valid accounts and a positive exact amount. Reject insufficient CASH/PETTY_CASH balance; disclose bank overdraft through the derived balance without inventing a limit.
- [ ] Show all cash/bank/petty-cash accounts, derived balances, recent activity, and a print-friendly transaction/detail document.

### Task 4: Expense vouchers and controlled reversals

**Files:**

- Create: `src/modules/accounting/application/expense-contracts.ts`
- Create: `src/modules/accounting/application/manage-expenses.ts`
- Create: `src/server/accounting/prisma-expense-repository.ts`
- Create: `src/app/(erp)/accounting/expenses/**`
- Create: `src/components/accounting/expense-*.tsx`

**Consumes:** active treasury accounts, active posting-enabled expense accounts, Phase 22 periods/journals.
**Produces:** `EXP-{year}-{sequence}` DRAFT/POSTED/CANCELLED voucher lifecycle, print view, list filters, and linked opposite reversal.

- [ ] Recalculate total from one or more positive exact expense lines server-side, reject control accounts and all non-EXPENSE account types, and use tax-inclusive line amounts.
- [ ] POSTED voucher atomically creates one `Dr expense lines / Cr treasury GL` journal and applies the cash/petty-cash negative-balance guard. DRAFT may be edited/cancelled; POSTED is immutable.
- [ ] Reversal requires accounting management permission, reason, reversal date in an OPEN period, and creates exactly one linked opposite journal/document without deleting the original voucher.
- [ ] Provide server-paginated/filterable expense list, detail, printable voucher, and accounting dashboard summaries derived from posted facts.

### Task 5: Reconciliation, documentation, and permitted checks

**Files:**

- Modify: `src/server/accounting/prisma-accounting-repository.ts`
- Modify: `src/app/(erp)/accounting/reconciliation/page.tsx`
- Modify: `docs/phases/current.md`, `docs/architecture/data-integrity.md`, `docs/architecture/boundaries.md`, `progress.md`

**Consumes:** all Phase 23 source records and Phase 22 reconciliation.
**Produces:** AP/treasury reconciliation views and concise Phase 23 contract documentation.

- [ ] Keep AP reconciliation based on the existing supplier-payable ledger and AP GL balance after payment relief; display mismatches rather than repairing them.
- [ ] Reconcile each treasury UI ledger to its linked GL account because both are derived from the same authoritative POSTED lines; do not claim external bank-statement reconciliation.
- [ ] Record routes, lifecycles, allocation/advance rules, cash-negative guard, deferred features, and the next phase only after the required implementation checks pass.
- [ ] Run only `prisma validate`, `prisma generate`, migration deployment/status, `db:check`, formatting, lint, TypeScript, production build, and `git diff --check`; do not run automated tests or aggregate commands that run them.
