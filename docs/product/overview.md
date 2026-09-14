# Product overview

Factory ERP will manage operations for food manufacturers producing goods such as ketchup, juice, achaar/pickles, sauces, vinegar, jam, and syrups. The same application will eventually support desktop and responsive mobile workflows.

The long-term physical flow is:

```text
Supplier → purchase → receipt → inspection → raw/packaging stock
         → production → finished goods → sales/dispatch → customer
         → returns/payment
```

The accounting and value flow parallels the physical flow. Future scope includes materials, warehouses, suppliers, purchasing, quality, recipes/BOMs, batches, issues and returns, packaging consumption, yield and wastage, reprocessing, customers, sales, dispatch, returns, payments, accounting, reporting, and audit history.

The application implements authentication/RBAC, quantity and inventory masters, purchasing (purchase orders, GRN/QC, purchase returns, supplier payments, and purchase invoices matching against QC-accepted receipts), production planning and execution (recipes, batches, material/packaging issues, output, Reprocess, Waste & Damage), finished-lot output, sales through returns/payments, customer receivables, a double-entry General Ledger with financial statements, and a separate exact-decimal inventory-valuation and production-costing layer. The physical movement ledger remains quantity truth; moving weighted average and finalized batch snapshots provide cost basis. Native Windows deployment, PWA installation, and private Tailscale remote access are also implemented. Administration Settings owns a minimal company/factory profile used on printed documents and branding. All 58 sidebar workflows are complete; see `docs/testing/workflow-inventory.md` for the current, authoritative classification.
