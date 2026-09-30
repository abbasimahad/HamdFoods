import { PERMISSIONS, type PermissionCode } from "./permissions";

export const DEFAULT_ROLE_CODES = [
  "SUPER_ADMIN",
  "ADMIN",
  "STORE_KEEPER",
  "PURCHASER",
  "PRODUCTION_MANAGER",
  "QUALITY_CONTROL",
  "SALES",
  "ACCOUNTS",
  "VIEWER",
] as const;
export type DefaultRoleCode = (typeof DEFAULT_ROLE_CODES)[number];

export const DEFAULT_ROLE_NAMES: Readonly<Record<DefaultRoleCode, string>> = {
  SUPER_ADMIN: "Super Administrator",
  ADMIN: "Administrator",
  STORE_KEEPER: "Store Keeper",
  PURCHASER: "Purchaser",
  PRODUCTION_MANAGER: "Production Manager",
  QUALITY_CONTROL: "Quality Control",
  SALES: "Sales",
  ACCOUNTS: "Accounts",
  VIEWER: "Viewer",
};

export const DEFAULT_ROLE_PERMISSIONS: Readonly<
  Record<DefaultRoleCode, readonly PermissionCode[]>
> = {
  SUPER_ADMIN: PERMISSIONS,
  ADMIN: PERMISSIONS,
  // Receives goods against approved POs and runs receiving QC; keeps stock and records damage.
  STORE_KEEPER: [
    "dashboard.view",
    "inventory.view",
    "inventory.manage",
    "purchasing.view",
    "receiving.manage",
    "waste.manage",
  ],
  // Raises purchase orders and manages suppliers and returns. Approval (Accounts), receiving
  // (Store Keeper) and receiving QC (Store Keeper / Quality Control) sit with other people, so a
  // purchaser can neither approve nor receive its own order (ROLE-2).
  PURCHASER: ["dashboard.view", "purchasing.view", "purchasing.manage", "inventory.view"],
  PRODUCTION_MANAGER: [
    "dashboard.view",
    "inventory.view",
    "production.view",
    "production.manage",
    "waste.manage",
  ],
  // The independent second person who records receiving QC and releases reprocessed goods.
  QUALITY_CONTROL: [
    "dashboard.view",
    "inventory.view",
    "production.view",
    "purchasing.view",
    "quality.manage",
  ],
  // Books orders, dispatches and draft invoices/returns. Order approval, posting invoices and
  // credit notes, and cash handling sit with Accounts (maker/checker), so Sales cannot approve
  // its own orders, post receivables or credits, or take receipts.
  SALES: ["dashboard.view", "sales.view", "sales.manage", "inventory.view"],
  ACCOUNTS: [
    "dashboard.view",
    "accounting.view",
    "accounting.manage",
    "reports.view",
    "sales.view",
    "sales.approve",
    "sales_invoices.post",
    "customer_payments.manage",
    "purchasing.view",
    "purchase_orders.approve",
    "purchase_invoices.manage",
    "inventory.view",
  ],
  VIEWER: [
    "dashboard.view",
    "inventory.view",
    "purchasing.view",
    "production.view",
    "sales.view",
    "accounting.view",
    "reports.view",
  ],
};
