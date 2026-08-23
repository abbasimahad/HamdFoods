import { PERMISSIONS, type PermissionCode } from "./permissions";

export const DEFAULT_ROLE_CODES = [
  "SUPER_ADMIN",
  "ADMIN",
  "STORE_KEEPER",
  "PRODUCTION_MANAGER",
  "SALES",
  "ACCOUNTS",
  "VIEWER",
] as const;
export type DefaultRoleCode = (typeof DEFAULT_ROLE_CODES)[number];

export const DEFAULT_ROLE_NAMES: Readonly<Record<DefaultRoleCode, string>> = {
  SUPER_ADMIN: "Super Administrator",
  ADMIN: "Administrator",
  STORE_KEEPER: "Store Keeper",
  PRODUCTION_MANAGER: "Production Manager",
  SALES: "Sales",
  ACCOUNTS: "Accounts",
  VIEWER: "Viewer",
};

export const DEFAULT_ROLE_PERMISSIONS: Readonly<
  Record<DefaultRoleCode, readonly PermissionCode[]>
> = {
  SUPER_ADMIN: PERMISSIONS,
  ADMIN: PERMISSIONS,
  STORE_KEEPER: ["dashboard.view", "inventory.view", "inventory.manage"],
  PRODUCTION_MANAGER: ["dashboard.view", "inventory.view", "production.view", "production.manage"],
  SALES: ["dashboard.view", "sales.view", "sales.manage"],
  ACCOUNTS: ["dashboard.view", "accounting.view", "accounting.manage", "reports.view"],
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
