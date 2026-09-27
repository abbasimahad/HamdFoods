import Link from "next/link";
import { PageHeader } from "@/components/layout/page-header";
import { Card } from "@/components/ui/card";
import { ResponsiveContainer } from "@/components/ui/responsive-container";
import type { PermissionCode } from "@/modules/access/domain/permissions";
import { hasPermission } from "@/modules/access/domain/principal";
import { requirePermission } from "@/server/auth/server-guards";

const groups: readonly {
  title: string;
  permission: PermissionCode;
  links: readonly [string, string][];
}[] = [
  {
    title: "Financial statements",
    permission: "accounting.view",
    links: [
      ["Profit & Loss", "/accounting/reports/profit-loss"],
      ["Balance Sheet", "/accounting/reports/balance-sheet"],
      ["Cash Flow", "/accounting/reports/cash-flow"],
      ["Trial Balance", "/accounting/trial-balance"],
    ],
  },
  {
    title: "Sales & tax",
    permission: "accounting.view",
    links: [
      ["Sales & Product Profitability", "/accounting/reports/sales-profitability"],
      ["Sales Tax (Output / Input)", "/accounting/reports/sales-tax"],
      ["Receivables Aging", "/accounting/reports/receivables-aging"],
    ],
  },
  {
    title: "Purchasing & cash",
    permission: "accounting.view",
    links: [
      ["Payables Aging", "/accounting/reports/payables-aging"],
      ["Expense & Treasury Analysis", "/accounting/reports/expenses-treasury"],
    ],
  },
  {
    title: "Stock",
    permission: "inventory.view",
    links: [
      ["Stock Overview", "/inventory/stock-overview"],
      ["Stock Movements", "/inventory/stock-movements"],
      ["Inventory Valuation", "/inventory/valuation"],
    ],
  },
  {
    title: "Production costing",
    permission: "accounting.view",
    links: [
      ["Inventory Valuation & Reconciliation", "/accounting/reports/inventory-valuation"],
      ["WIP & Production Costing", "/accounting/reports/production-costing"],
    ],
  },
];

export default async function Page() {
  const principal = await requirePermission("reports.view");
  const visible = groups.filter((group) => hasPermission(principal, group.permission));
  return (
    <ResponsiveContainer>
      <PageHeader
        title="Reports"
        description="Operational and financial reports, each generated live from posted records."
      />
      {visible.length ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {visible.map((group) => (
            <Card className="p-5" key={group.title}>
              <h2 className="mb-3 font-semibold">{group.title}</h2>
              <ul className="space-y-2 text-sm">
                {group.links.map(([label, href]) => (
                  <li key={href}>
                    <Link className="font-medium text-[var(--accent)]" href={href}>
                      {label}
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          ))}
        </div>
      ) : (
        <Card className="p-5 text-sm text-[var(--muted)]">
          Your role has no report areas assigned. Ask an administrator for accounting or inventory
          view access.
        </Card>
      )}
    </ResponsiveContainer>
  );
}
