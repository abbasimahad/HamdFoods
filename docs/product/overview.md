# Product overview

Factory ERP will manage operations for food manufacturers producing goods such as ketchup, juice, achaar/pickles, sauces, vinegar, jam, and syrups. The same application will eventually support desktop and responsive mobile workflows.

The long-term physical flow is:

```text
Supplier → purchase → receipt → inspection → raw/packaging stock
         → production → finished goods → sales/dispatch → customer
         → returns/payment
```

The accounting and value flow parallels the physical flow. Future scope includes materials, warehouses, suppliers, purchasing, quality, recipes/BOMs, batches, issues and returns, packaging consumption, yield and wastage, reprocessing, customers, sales, dispatch, returns, payments, accounting, reporting, and audit history.

Through Phase 21, the application implements authentication/RBAC, quantity and inventory masters, purchasing and supplier-lot control, production planning and execution, finished-lot output, sales through returns/payments, customer receivables, and a separate exact-decimal inventory-valuation and production-costing layer. The physical movement ledger remains quantity truth; moving weighted average and finalized batch snapshots provide cost basis. General Ledger, AP/COGS/revenue journals, financial statements, PWA installation, remote access, Tailscale, and deployment remain deferred.
