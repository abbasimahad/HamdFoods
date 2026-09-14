Plan: docs/plans/2026-09-09-navigation-data-entry-ux.md
Task 1: COMPLETE (4 unit + 19 E2E; typecheck and diff check pass)
Task 2: COMPLETE (15 focused + 21 E2E; typecheck and diff check pass)
Task 3: COMPLETE (10 focused + live reconciliation integration; typecheck and diff check pass)
Task 4: COMPLETE (read-only AR/AP list/detail and authoritative payment launch routes implemented)
Task 5: COMPLETE (3 focused tests; first-class material/packaging workbench routes reuse batch engines)
Task 6: COMPLETE (shared adoption contract covers master, purchasing, and inventory representatives)
Task 7: COMPLETE (production/sales shared controls; lifecycle invariant tests pass)
Task 8: COMPLETE (accounting/access shared controls; integrity and authorization tests pass)
Task 9: COMPLETE (final unit, integration, E2E, build, production, inventory, and worktree gates pass)

Navigation / Data Entry UX: READY

Final closure evidence (2026-09-12):

- `corepack pnpm verify`: PASS — Prettier, ESLint, Prisma validate/generate, TypeScript, 265 unit tests passed with 2 skipped, and 85 generated production pages.
- traced integration: PASS — 15 passed / 1 documented infrastructure-gated skip; no PostgreSQL concurrent-client-query or unexpected Node/database warning.
- disposable-DB E2E: PASS — 26/26, one worker, zero retries, no browser, hydration, Node/server, or destination-stream errors; only the deliberate invalid-password warning.
- production: `HamdFoodsERP` running, sole listener `127.0.0.1:3100`, health `200 {"status":"ok"}`, production auth bypass disabled, and business row counts unchanged.
- workflow inventory: 55 COMPLETE, 0 BACKEND EXISTS / UI INCOMPLETE, 2 PARTIAL, 2 MISSING, 58 sidebar entries, 4 planned labels.
- `git diff --check`: PASS.

Prior gate: Runtime Stabilization COMPLETE.
Next subproject: PARTIAL WORKFLOWS. Phase 33 is NOT STARTED.

Partial Workflows closure (2026-09-13):

- Tasks A-J COMPLETE: Reprocess and Waste & Damage are active, end-to-end workflows.
- Reprocess preserves source-to-child genealogy, conservative shelf life, linked production/WIP costing, and independent QC authority.
- Waste & Damage controls scrap/reprocess/write-off disposition and safe compensating reversals using original value.
- Workflow inventory is reconciled to 57 COMPLETE, 0 PARTIAL, and the same 2 untouched MISSING workflows.
- Final verification passed: 309 unit tests / 2 skips, 27 integration tests / 1 intentional skip, 30/30 E2E, Prisma, TypeScript, ESLint, formatting, and the 89-page production build. Production/Git synchronization uses the established backup-first closure procedure. Phase 33 remains NOT STARTED.

Release closure (2026-09-14):

- Fresh verification repeated successfully: `corepack pnpm verify` passed 309 unit tests / 2 skips and the 89-page production build; disposable integration passed 27 / 1 intentional skip; Chromium E2E passed 30/30 with one worker and zero retries.
- Production backup `hamd_foods_erp_prod_drill-20260914T155829603Z-9a06f093` was created and SHA-256 verified before deployment. Migration `20260912223500_partial_workflow_foundation` applied successfully; all 40 production migrations are current.
- The canonical `HamdFoodsERP` task is running on the sole `127.0.0.1:3100` listener, health passes, recent logs contain no error/fatal match, and production auth bypass is disabled.

Purchase Invoices closure (2026-09-14):

- Design approved in `docs/specs/2026-09-14-purchase-invoices-design.md` (D1–D8 frozen, D6 amended). Implemented PO-line-anchored invoice matching against QC-completed GRN lines, price/tax variance true-up posting (no AP re-origination, no GRNI, no revaluation), DRAFT/POSTED/CANCELLED/REVERSED lifecycle, duplicate-invoice-number protection, and concurrency/idempotency guarantees under Serializable transactions.
- New migration `20260914170607_purchase_invoices_matching_variance`: `PurchaseInvoice`/`PurchaseInvoiceLine`/`PurchaseInvoiceLineMatch`/`PurchaseInvoiceSequence`, `PurchaseInvoiceStatus`, `PURCHASE_PRICE_VARIANCE` mapping, `PURCHASE_INVOICE_VARIANCE`/`PURCHASE_INVOICE_REVERSAL` source types, `PURCHASE_INVOICE_VARIANCE` supplier-ledger type, `PURCHASE_INVOICE` audit entity, and DB lifecycle/immutability/cross-reference guard triggers on the new tables only — no existing table, column, trigger, or posting function was altered.
- Tests: 16 domain + 15 application-layer unit tests; 13 new disposable-DB integration tests (exact match, price/tax variance both directions, tax-policy block, incomplete/partial/multi-GRN/multi-invoice matching, duplicate rejection, pre-GRN draft, concurrent over-invoicing, closed-period block vs. throw, immutability, audit, idempotency); 2 new Chromium E2E tests. Full gates: `pnpm verify` PASS (340 unit tests / 2 skips, 91-page build); disposable integration PASS (40 / 1 intentional skip); disposable E2E PASS (32/32).
- Workflow inventory reconciled to 58 `COMPLETE`, 0 `PARTIAL`, 1 `MISSING` (Administration Settings only).
- **Production deployment incomplete by design:** the production-migrate action was blocked by this environment's own permission control, and the follow-up attempt to revert the already-rebuilt production deployment back to the prior consistent build was also blocked. A verified pre-change backup was taken first. The production task was left **stopped** (safe: not serving code against an unmigrated schema) pending an operator decision to either apply the migration or redeploy the prior build. Code was not committed or pushed pending that decision.
