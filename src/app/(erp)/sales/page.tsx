import Link from "next/link";
import { PageHeader } from "@/components/layout/page-header";
import { Card } from "@/components/ui/card";
import { ResponsiveContainer } from "@/components/ui/responsive-container";
import { requirePermission } from "@/server/auth/server-guards";
export default async function Page() {
  await requirePermission("sales.view");
  return (
    <ResponsiveContainer>
      <PageHeader
        title="Sales"
        description="Sales Orders reserve finished goods, Dispatches move custody to transit, invoices create receivables, and payments settle them."
      />
      <Card className="grid gap-3 p-5 md:grid-cols-2 xl:grid-cols-5">
        {(
          [
            ["Sales Orders", "/sales/orders"],
            ["Dispatches", "/sales/dispatches"],
            ["Sales Invoices", "/sales/invoices"],
            ["Customer Payments", "/sales/payments"],
            ["Customers", "/sales/customers"],
            ["Customer Groups", "/sales/customer-groups"],
            ["Areas", "/sales/areas"],
            ["Routes", "/sales/routes"],
            ["Salespersons", "/sales/salespersons"],
          ] as const
        ).map(([label, href]) => (
          <Link
            className="rounded-lg border border-[var(--border)] p-4 font-semibold text-[var(--accent)]"
            href={href}
            key={href}
          >
            {label}
          </Link>
        ))}
      </Card>
    </ResponsiveContainer>
  );
}
