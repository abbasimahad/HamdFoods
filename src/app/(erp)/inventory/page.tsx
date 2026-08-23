import Link from "next/link";

import { PageHeader } from "@/components/layout/page-header";
import { Card } from "@/components/ui/card";
import { ResponsiveContainer } from "@/components/ui/responsive-container";
import { routes } from "@/config/navigation";
import { requirePermission } from "@/server/auth/server-guards";

const masters = [
  ["Units", routes.future.inventory.units, "Stock and product-content units"],
  ["Categories", routes.future.inventory.categories, "Type-specific item classification"],
  ["Raw Materials", routes.future.inventory.rawMaterials, "Ingredients and processing materials"],
  [
    "Packaging Materials",
    routes.future.inventory.packagingMaterials,
    "Bottles, closures, labels, and cartons",
  ],
  [
    "Finished Goods",
    routes.future.inventory.finishedGoods,
    "Products, net content, and carton definitions",
  ],
  [
    "Quantity Calculator",
    routes.future.inventory.quantityCalculator,
    "Exact unit, carton, piece, and product-content calculations",
  ],
  ["Warehouses", routes.future.inventory.warehouses, "Warehouse-level stock locations"],
  ["Stock Overview", routes.future.inventory.stockOverview, "Ledger-derived current quantities"],
  [
    "Stock Movements",
    routes.future.inventory.stockMovements,
    "Immutable inventory movement history",
  ],
  [
    "Stock Adjustments",
    routes.future.inventory.stockAdjustments,
    "Opening stock, adjustments, and transfers",
  ],
] as const;

export default async function Page() {
  await requirePermission("inventory.view");
  return (
    <ResponsiveContainer>
      <PageHeader
        description="Maintain masters, post controlled ledger movements, and inspect warehouse stock calculated from immutable history."
        title="Inventory"
      />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {masters.map(([label, href, description]) => (
          <Link
            className="outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)]"
            href={href}
            key={href}
          >
            <Card className="h-full p-5 transition-colors hover:border-[var(--accent)]">
              <h2 className="font-semibold">{label}</h2>
              <p className="mt-2 text-sm leading-6 text-[var(--muted)]">{description}</p>
            </Card>
          </Link>
        ))}
      </div>
      <Card className="mt-5 p-5">
        <h2 className="font-semibold">Ledger-authoritative inventory</h2>
        <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
          Current quantity is always the sum of signed canonical movements. Carton views and
          readable units are derived for display and are never stored as separate balances.
        </p>
      </Card>
    </ResponsiveContainer>
  );
}
