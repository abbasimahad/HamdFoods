import { InventoryPostingForm } from "@/components/inventory/inventory-posting-form";
import { PageHeader } from "@/components/layout/page-header";
import { Card } from "@/components/ui/card";
import { ResponsiveContainer } from "@/components/ui/responsive-container";
import { hasPermission } from "@/modules/access/domain/principal";
import { requirePermission } from "@/server/auth/server-guards";
import { PrismaInventoryRepository } from "@/server/inventory/prisma-inventory-repository";

import { postSingleInventoryAction, transferInventoryAction } from "./actions";

export default async function StockAdjustmentsPage() {
  const principal = await requirePermission("inventory.view");
  const repository = new PrismaInventoryRepository();
  const [items, units, warehouses] = await Promise.all([
    repository.listPostingItems(),
    repository.listPostingUnits(),
    repository.listActiveWarehouses(),
  ]);
  const canManage = hasPermission(principal, "inventory.manage");
  return (
    <ResponsiveContainer>
      <PageHeader
        title="Stock Adjustments"
        description="Post opening inventory, audited manual adjustments, and atomic warehouse transfers. Existing ledger history is never edited."
      />
      {canManage ? (
        <div className="space-y-5">
          <PostingCard
            title="Opening stock"
            description="Establish initial stock from a migration or physical opening count."
          >
            <InventoryPostingForm
              action={postSingleInventoryAction}
              mode="OPENING_BALANCE"
              items={items}
              units={units}
              warehouses={warehouses}
            />
          </PostingCard>
          <PostingCard
            title="Adjustment in"
            description="Record discovered inventory as a positive ledger movement."
          >
            <InventoryPostingForm
              action={postSingleInventoryAction}
              mode="ADJUSTMENT_IN"
              items={items}
              units={units}
              warehouses={warehouses}
            />
          </PostingCard>
          <PostingCard
            title="Adjustment out"
            description="Record a shortage. The selected source bucket cannot become negative."
          >
            <InventoryPostingForm
              action={postSingleInventoryAction}
              mode="ADJUSTMENT_OUT"
              items={items}
              units={units}
              warehouses={warehouses}
            />
          </PostingCard>
          <PostingCard
            title="Warehouse transfer"
            description="Post linked source and destination movements in one transaction."
          >
            <InventoryPostingForm
              action={transferInventoryAction}
              mode="TRANSFER"
              items={items}
              units={units}
              warehouses={warehouses}
            />
          </PostingCard>
        </div>
      ) : (
        <Card className="p-5 text-sm text-[var(--muted)]">
          You can inspect stock and movement history, but inventory.manage is required to post
          changes.
        </Card>
      )}
    </ResponsiveContainer>
  );
}

function PostingCard({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <Card className="p-5">
      <h2 className="font-semibold">{title}</h2>
      <p className="mb-4 mt-1 text-sm text-[var(--muted)]">{description}</p>
      {children}
    </Card>
  );
}
