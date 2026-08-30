import type { PermissionCode } from "@/modules/access/domain/permissions";
import { hasPermission, type ApplicationPrincipal } from "@/modules/access/domain/principal";

export const routes = {
  home: "/",
  dashboard: "/dashboard",
  inventory: "/inventory",
  purchasing: "/purchasing",
  production: "/production",
  sales: "/sales",
  accounting: "/accounting",
  reports: "/reports",
  administration: "/administration",
  login: "/login",
  accessDenied: "/access-denied",
  systemHealth: "/system-health",
  future: {
    inventory: {
      units: "/inventory/units",
      categories: "/inventory/categories",
      stockOverview: "/inventory/stock-overview",
      rawMaterials: "/inventory/raw-materials",
      packagingMaterials: "/inventory/packaging-materials",
      finishedGoods: "/inventory/finished-goods",
      quantityCalculator: "/inventory/quantity-calculator",
      stockMovements: "/inventory/stock-movements",
      stockAdjustments: "/inventory/stock-adjustments",
      valuation: "/inventory/valuation",
      warehouses: "/inventory/warehouses",
    },
    purchasing: {
      purchaseOrders: "/purchasing/purchase-orders",
      goodsReceiving: "/purchasing/goods-receiving",
      purchaseInvoices: "/purchasing/purchase-invoices",
      purchaseReturns: "/purchasing/purchase-returns",
      suppliers: "/purchasing/suppliers",
      supplierPayments: "/purchasing/supplier-payments",
    },
    production: {
      recipes: "/production/recipes",
      batches: "/production/batches",
      materialIssues: "/production/material-issues",
      packagingConsumption: "/production/packaging-consumption",
      reprocess: "/production/reprocess",
      wasteDamage: "/production/waste-damage",
    },
    sales: {
      orders: "/sales/orders",
      dispatches: "/sales/dispatches",
      invoices: "/sales/invoices",
      payments: "/sales/payments",
      returns: "/sales/returns",
      customers: "/sales/customers",
      customerGroups: "/sales/customer-groups",
      areas: "/sales/areas",
      routes: "/sales/routes",
      salespersons: "/sales/salespersons",
    },
    accounting: {
      chartOfAccounts: "/accounting/chart-of-accounts",
      journals: "/accounting/journals",
      manualJournals: "/accounting/manual-journals",
      settings: "/accounting/settings",
      cashBankAccounts: "/accounting/cash-bank-accounts",
      transfers: "/accounting/transfers",
      receivables: "/accounting/receivables",
      payables: "/accounting/payables",
      expenses: "/accounting/expenses",
      journalVouchers: "/accounting/journal-vouchers",
      generalLedger: "/accounting/general-ledger",
      trialBalance: "/accounting/trial-balance",
      reconciliation: "/accounting/reconciliation",
      financialReports: "/accounting/reports",
      profitLoss: "/accounting/reports/profit-loss",
      balanceSheet: "/accounting/reports/balance-sheet",
      cashFlow: "/accounting/reports/cash-flow",
    },
    administration: {
      users: "/administration/users",
      rolesPermissions: "/administration/roles-permissions",
      settings: "/administration/settings",
      auditLog: "/administration/audit-log",
    },
  },
} as const;

export type NavigationIcon =
  | "dashboard"
  | "inventory"
  | "purchasing"
  | "production"
  | "sales"
  | "accounting"
  | "reports"
  | "administration";

export type NavigationChild = {
  label: string;
  href: string;
  status: "planned" | "active";
  permission?: PermissionCode;
};

export type NavigationItem = {
  id: NavigationIcon;
  label: string;
  href: string;
  icon: NavigationIcon;
  permission?: PermissionCode;
  anyPermissions?: readonly PermissionCode[];
  children?: readonly NavigationChild[];
};

function planned(label: string, href: string): NavigationChild {
  return { label, href, status: "planned" };
}

function active(label: string, href: string, permission: PermissionCode): NavigationChild {
  return { label, href, status: "active", permission };
}

export const appNavigation: readonly NavigationItem[] = [
  {
    id: "dashboard",
    label: "Dashboard",
    href: routes.dashboard,
    icon: "dashboard",
    permission: "dashboard.view",
  },
  {
    id: "inventory",
    label: "Inventory",
    href: routes.inventory,
    icon: "inventory",
    permission: "inventory.view",
    children: [
      active("Units", routes.future.inventory.units, "inventory.view"),
      active("Categories", routes.future.inventory.categories, "inventory.view"),
      active("Raw Materials", routes.future.inventory.rawMaterials, "inventory.view"),
      active("Packaging Materials", routes.future.inventory.packagingMaterials, "inventory.view"),
      active("Finished Goods", routes.future.inventory.finishedGoods, "inventory.view"),
      active("Quantity Calculator", routes.future.inventory.quantityCalculator, "inventory.view"),
      active("Stock Overview", routes.future.inventory.stockOverview, "inventory.view"),
      active("Stock Movements", routes.future.inventory.stockMovements, "inventory.view"),
      active("Stock Adjustments", routes.future.inventory.stockAdjustments, "inventory.view"),
      active("Inventory Valuation", routes.future.inventory.valuation, "inventory.view"),
      active("Warehouses", routes.future.inventory.warehouses, "inventory.view"),
    ],
  },
  {
    id: "purchasing",
    label: "Purchasing",
    href: routes.purchasing,
    icon: "purchasing",
    permission: "purchasing.view",
    children: [
      active("Purchase Orders", routes.future.purchasing.purchaseOrders, "purchasing.view"),
      active("Goods Receiving", routes.future.purchasing.goodsReceiving, "purchasing.view"),
      planned("Purchase Invoices", routes.future.purchasing.purchaseInvoices),
      active("Purchase Returns", routes.future.purchasing.purchaseReturns, "purchasing.view"),
      active("Suppliers", routes.future.purchasing.suppliers, "purchasing.view"),
      active("Supplier Payments", routes.future.purchasing.supplierPayments, "accounting.view"),
    ],
  },
  {
    id: "production",
    label: "Production",
    href: routes.production,
    icon: "production",
    permission: "production.view",
    children: [
      active("Recipes / BOM", routes.future.production.recipes, "production.view"),
      active("Production Batches", routes.future.production.batches, "production.view"),
      planned("Material Issues", routes.future.production.materialIssues),
      planned("Packaging Consumption", routes.future.production.packagingConsumption),
      planned("Reprocess", routes.future.production.reprocess),
      planned("Waste & Damage", routes.future.production.wasteDamage),
    ],
  },
  {
    id: "sales",
    label: "Sales",
    href: routes.sales,
    icon: "sales",
    permission: "sales.view",
    children: [
      active("Sales Orders", routes.future.sales.orders, "sales.view"),
      active("Dispatches", routes.future.sales.dispatches, "sales.view"),
      active("Sales Invoices", routes.future.sales.invoices, "sales.view"),
      active("Customer Payments", routes.future.sales.payments, "sales.view"),
      active("Sales Returns", routes.future.sales.returns, "sales.view"),
      active("Customers", routes.future.sales.customers, "sales.view"),
      active("Customer Groups", routes.future.sales.customerGroups, "sales.view"),
      active("Areas", routes.future.sales.areas, "sales.view"),
      active("Routes", routes.future.sales.routes, "sales.view"),
      active("Salespersons", routes.future.sales.salespersons, "sales.view"),
    ],
  },
  {
    id: "accounting",
    label: "Accounting",
    href: routes.accounting,
    icon: "accounting",
    permission: "accounting.view",
    children: [
      active("Chart of Accounts", routes.future.accounting.chartOfAccounts, "accounting.view"),
      active("Journals", routes.future.accounting.journals, "accounting.view"),
      active("General Ledger", routes.future.accounting.generalLedger, "accounting.view"),
      active("Trial Balance", routes.future.accounting.trialBalance, "accounting.view"),
      active("Reconciliation", routes.future.accounting.reconciliation, "accounting.view"),
      active("Financial Reports", routes.future.accounting.financialReports, "accounting.view"),
      active("Manual Journals", routes.future.accounting.manualJournals, "accounting.manage"),
      active("Settings & Periods", routes.future.accounting.settings, "accounting.manage"),
      active("Cash & Bank", routes.future.accounting.cashBankAccounts, "accounting.view"),
      active("Treasury Transfers", routes.future.accounting.transfers, "accounting.view"),
      planned("Receivables", routes.future.accounting.receivables),
      planned("Payables", routes.future.accounting.payables),
      active("Expenses", routes.future.accounting.expenses, "accounting.view"),
      planned("Journal Vouchers", routes.future.accounting.journalVouchers),
    ],
  },
  {
    id: "reports",
    label: "Reports",
    href: routes.reports,
    icon: "reports",
    permission: "reports.view",
  },
  {
    id: "administration",
    label: "Administration",
    href: routes.administration,
    icon: "administration",
    anyPermissions: ["users.view", "users.manage", "roles.manage", "audit.view"],
    children: [
      {
        label: "Users",
        href: routes.future.administration.users,
        status: "active",
        permission: "users.view",
      },
      {
        label: "Roles & Permissions",
        href: routes.future.administration.rolesPermissions,
        status: "active",
        permission: "roles.manage",
      },
      planned("Settings", routes.future.administration.settings),
      active("Audit Log", routes.future.administration.auditLog, "audit.view"),
    ],
  },
] as const;

export function getPermittedNavigation(principal: ApplicationPrincipal): readonly NavigationItem[] {
  return appNavigation
    .filter((item) =>
      item.permission
        ? hasPermission(principal, item.permission)
        : (item.anyPermissions?.some((permission) => hasPermission(principal, permission)) ?? true),
    )
    .map((item) =>
      item.children
        ? {
            ...item,
            children: item.children.filter(
              (child) => !child.permission || hasPermission(principal, child.permission),
            ),
          }
        : item,
    );
}

export function getActiveNavigationItem(pathname: string): NavigationItem | undefined {
  return appNavigation.find(
    (item) => pathname === item.href || pathname.startsWith(`${item.href}/`),
  );
}
