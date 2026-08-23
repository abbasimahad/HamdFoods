import Link from "next/link";
import { PageHeader } from "@/components/layout/page-header";
import { Card } from "@/components/ui/card";
import { ResponsiveContainer } from "@/components/ui/responsive-container";
import { routes } from "@/config/navigation";
import { requirePermission } from "@/server/auth/server-guards";

const entries = [
  [
    "Purchase Orders",
    routes.future.purchasing.purchaseOrders,
    "Create, approve, cancel, inspect, and print purchasing commitments.",
  ],
  [
    "Suppliers",
    routes.future.purchasing.suppliers,
    "Maintain active suppliers and retained historical supplier details.",
  ],
  [
    "Goods Receiving",
    routes.future.purchasing.goodsReceiving,
    "Receive approved POs into quality hold and complete accepted/rejected QC classification.",
  ],
] as const;

export default async function PurchasingPage() {
  await requirePermission("purchasing.view");
  return (
    <ResponsiveContainer>
      <PageHeader
        title="Purchasing"
        description="Manage suppliers and controlled purchase-order commitments without prematurely affecting inventory or accounting."
      />
      <div className="grid gap-4 sm:grid-cols-2">
        {entries.map(([label, href, description]) => (
          <Link key={href} href={href}>
            <Card className="h-full p-5 transition-colors hover:border-[var(--accent)]">
              <h2 className="font-semibold">{label}</h2>
              <p className="mt-2 text-sm leading-6 text-[var(--muted)]">{description}</p>
            </Card>
          </Link>
        ))}
      </div>
      <Card className="mt-5 p-5">
        <h2 className="font-semibold">Phase 7 boundary</h2>
        <p className="mt-2 text-sm text-[var(--muted)]">
          Purchase orders record intent only. Posted goods receipts create quality-hold stock, and
          QC controls movement to available or quarantine. Financial effects remain deferred to
          future invoice/accounting workflows.
        </p>
      </Card>
    </ResponsiveContainer>
  );
}
