export const PERMISSIONS = [
  "dashboard.view",
  "inventory.view",
  "inventory.manage",
  "purchasing.view",
  "purchasing.manage",
  "purchase_orders.approve",
  "receiving.manage",
  "purchase_invoices.manage",
  "production.view",
  "production.manage",
  "quality.manage",
  "waste.manage",
  "sales.view",
  "sales.manage",
  "sales.approve",
  "sales.credit_override",
  "sales_invoices.post",
  "dispatches.manage",
  "customer_payments.manage",
  "accounting.view",
  "accounting.manage",
  "accounting_periods.reopen_approve",
  "reports.view",
  "users.view",
  "users.manage",
  "roles.manage",
  "audit.view",
  "settings.manage",
  "license.manage",
  "updates.manage",
] as const;

export type PermissionCode = (typeof PERMISSIONS)[number];

export function isPermissionCode(value: string): value is PermissionCode {
  return (PERMISSIONS as readonly string[]).includes(value);
}

export const PERMISSION_DESCRIPTIONS: Readonly<Record<PermissionCode, string>> = {
  "dashboard.view": "View the ERP dashboard",
  "inventory.view": "View inventory modules",
  "inventory.manage": "Manage inventory operations",
  "purchasing.view": "View purchasing modules",
  "purchasing.manage": "Manage purchasing operations",
  "purchase_orders.approve": "Approve purchase orders raised by purchasing",
  "receiving.manage": "Receive goods against purchase orders and record receiving QC",
  "purchase_invoices.manage": "Enter, post and reverse supplier invoices",
  "production.view": "View production modules",
  "production.manage": "Manage production operations",
  "quality.manage":
    "Record receiving QC, review/release reprocessed finished goods and inspect customer returns",
  "waste.manage": "Record and post waste, damage and write-offs",
  "sales.view": "View sales modules",
  "sales.manage": "Manage sales operations",
  "sales.approve": "Approve sales orders (reserve stock and release credit)",
  "sales.credit_override":
    "Approve a sales order over the customer credit limit, with a recorded reason",
  "sales_invoices.post": "Post sales invoices and customer credit notes",
  "dispatches.manage": "Create, post and confirm dispatches and print gate passes",
  "customer_payments.manage": "Record, post and reverse customer receipts",
  "accounting.view": "View accounting modules",
  "accounting.manage": "Manage accounting operations",
  "accounting_periods.reopen_approve":
    "Approve or reject a request to reopen a closed accounting period",
  "reports.view": "View reports",
  "users.view": "View application users",
  "users.manage": "Create users and manage user access",
  "roles.manage": "Manage role permission mappings",
  "audit.view": "View audit history",
  "settings.manage": "Manage company/factory profile settings",
  "license.manage": "View and manage software license activation",
  "updates.manage": "Upload, verify, install, and recover software updates",
};
