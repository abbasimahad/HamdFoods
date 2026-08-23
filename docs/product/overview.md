# Product overview

Factory ERP will manage operations for food manufacturers producing goods such as ketchup, juice, achaar/pickles, sauces, vinegar, jam, and syrups. The same application will eventually support desktop and responsive mobile workflows.

The long-term physical flow is:

```text
Supplier → purchase → receipt → inspection → raw/packaging stock
         → production → finished goods → sales/dispatch → customer
         → returns/payment
```

The accounting and value flow parallels the physical flow. Future scope includes materials, warehouses, suppliers, purchasing, quality, recipes/BOMs, batches, issues and returns, packaging consumption, yield and wastage, reprocessing, customers, sales, dispatch, returns, payments, accounting, reporting, and audit history.

Through Phase 8, the application implements authentication/RBAC, item and quantity masters, warehouse inventory ledgers, supplier masters, purchase orders, physical goods receiving, purchase QC, and supplier-lot foundations. Purchase returns, invoices/payables, production, sales, accounting, PWA installation, remote access, Tailscale, and deployment remain deferred.
