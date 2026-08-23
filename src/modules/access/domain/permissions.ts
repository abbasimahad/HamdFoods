export const PERMISSIONS = [
  "dashboard.view",
  "inventory.view",
  "inventory.manage",
  "purchasing.view",
  "purchasing.manage",
  "production.view",
  "production.manage",
  "sales.view",
  "sales.manage",
  "accounting.view",
  "accounting.manage",
  "reports.view",
  "users.view",
  "users.manage",
  "roles.manage",
  "audit.view",
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
  "production.view": "View production modules",
  "production.manage": "Manage production operations",
  "sales.view": "View sales modules",
  "sales.manage": "Manage sales operations",
  "accounting.view": "View accounting modules",
  "accounting.manage": "Manage accounting operations",
  "reports.view": "View reports",
  "users.view": "View application users",
  "users.manage": "Create users and manage user access",
  "roles.manage": "Manage role permission mappings",
  "audit.view": "View audit history",
};
