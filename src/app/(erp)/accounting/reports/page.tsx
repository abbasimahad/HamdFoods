import Link from "next/link";
import { PageHeader } from "@/components/layout/page-header";
import { ResponsiveContainer } from "@/components/ui/responsive-container";
import { Card } from "@/components/ui/card";
import { requirePermission } from "@/server/auth/server-guards";
const reports = [
  ["Profit & Loss", "profit-loss"],
  ["Balance Sheet", "balance-sheet"],
  ["Cash Flow", "cash-flow"],
  ["Accounts Receivable Aging", "receivables-aging"],
  ["Accounts Payable Aging", "payables-aging"],
  ["Inventory Valuation & Reconciliation", "inventory-valuation"],
  ["WIP & Production Costing", "production-costing"],
  ["Sales & Product Profitability", "sales-profitability"],
  ["Expense & Treasury Analysis", "expenses-treasury"],
] as const;
export default async function Page() {
  await requirePermission("accounting.view");
  return (
    <ResponsiveContainer>
      <PageHeader
        title="Financial Reports"
        description="Server-generated, printable reports derived from posted journals and authoritative operational ledgers."
      />
      <Card className="grid gap-3 p-5 md:grid-cols-2">
        {reports.map(([label, slug]) => (
          <Link
            className="font-semibold text-[var(--accent)]"
            href={`/accounting/reports/${slug}`}
            key={slug}
          >
            {label}
          </Link>
        ))}
      </Card>
    </ResponsiveContainer>
  );
}
